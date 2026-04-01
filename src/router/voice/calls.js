import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { getTwilioClient, getUserPhoneNumber, mapCall, cacheGet, cacheSet, cacheInvalidateByPrefix, isSmsSentForCall, isCallMissed, wasCallerMissed, batchCheckMissed, batchCheckSmsSent } from "./shared.js";
import { defaultDB } from "../../server/db.js";
import { MISSED_CALL_SMS_COLLECTION } from "../../constants/index.js";

const router = Router();

const enrichWithSmsStatus = async (calls) => {
  if (!calls.length) return calls;

  const sids = calls.map(c => c.id);
  const [missedSet, smsSentSet] = await Promise.all([
    batchCheckMissed(sids),
    batchCheckSmsSent(sids),
  ]);

  return calls.map(c => ({
    ...c,
    smsSent: smsSentSet.has(c.id),
    status: missedSet.has(c.id) ? "missed" : c.status,
  }));
};

router.get("/calls", verifyToken, async (req, res) => {
  const { limit = 50, status, search } = req.query;
  const { uuid } = req.user;

  const parsedLimit = parseInt(limit, 10);
  if (!Number.isNaN(parsedLimit) && parsedLimit > 200) {
    return res.status(400).json({ message: "Limit cannot exceed 200." });
  }

  const allowedStatuses = ["missed", "completed"];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status. Allowed values: missed, completed." });
  }

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({ success: true, data: [], total: 0 });
    }

    const client = getTwilioClient();
    const pageLimit = Math.min(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 200);
    const cacheKey = `calls:${uuid}:${pageLimit}`;
    const FINAL_STATUSES = ["completed", "no-answer", "busy", "canceled", "failed"];

    let calls = cacheGet(cacheKey);
    if (!calls) {
      const [inbound, outbound] = await Promise.all([
        client.calls.list({ to: userPhoneNumber, limit: pageLimit }),
        client.calls.list({ from: userPhoneNumber, limit: pageLimit }),
      ]);
      calls = [...inbound, ...outbound]
        .filter((c) => FINAL_STATUSES.includes(c.status))
        .sort((a, b) => b.startTime - a.startTime)
        .map(mapCall);
      cacheSet(cacheKey, calls);
    }

    let result = await enrichWithSmsStatus(calls);
    if (status === "missed") {
      result = result.filter((c) => c.status === "missed");
    } else if (status === "completed") {
      result = result.filter((c) => c.status === "completed");
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.callerNumber?.toLowerCase().includes(q) ||
          c.callerName?.toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, data: result, total: result.length });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch call logs." });
  }
});

router.get("/calls/stats", verifyToken, async (req, res) => {
  const { uuid } = req.user;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({
        success: true,
        data: {
          todayCallsCount: 0,
          missedCallsCount: 0,
          completedCallsCount: 0,
          incomingCallsCount: 0,
          outgoingCallsCount: 0,
          totalDuration: 0,
          averageDuration: 0,
        },
      });
    }

    const client = getTwilioClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [inbound, outbound] = await Promise.all([
      client.calls.list({ to: userPhoneNumber, startTimeAfter: todayStart }),
      client.calls.list({ from: userPhoneNumber, startTimeAfter: todayStart }),
    ]);

    const all = [...inbound, ...outbound];
    const totalDuration = all.reduce((sum, c) => sum + (parseInt(c.duration) || 0), 0);

    return res.json({
      success: true,
      data: {
        todayCallsCount: all.length,
        missedCallsCount: all.filter((c) => ["no-answer", "busy", "canceled", "failed"].includes(c.status)).length,
        completedCallsCount: all.filter((c) => c.status === "completed").length,
        incomingCallsCount: inbound.length,
        outgoingCallsCount: outbound.length,
        totalDuration,
        averageDuration: all.length ? Math.round(totalDuration / all.length) : 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch call stats." });
  }
});

const getAutoReplySidSet = async (phoneNumber) => {
  try {
    const [snapCaller, snapCalled] = await Promise.all([
      defaultDB.collection(MISSED_CALL_SMS_COLLECTION).where("callerNumber", "==", phoneNumber).get(),
      defaultDB.collection(MISSED_CALL_SMS_COLLECTION).where("calledNumber", "==", phoneNumber).get(),
    ]);
    const sidSet = new Set();
    [snapCaller, snapCalled].forEach((snap) =>
      snap.forEach((doc) => {
        const { smsSid } = doc.data();
        if (smsSid) sidSet.add(smsSid);
      })
    );
    return sidSet;
  } catch {
    return new Set();
  }
};

const mapSms = (msg, autoReplySids = new Set()) => ({
  type: "sms",
  id: msg.sid,
  body: msg.body,
  direction: msg.direction === "inbound" ? "incoming" : "outgoing",
  startTime: msg.dateSent?.toISOString() || msg.dateCreated?.toISOString() || null,
  status: msg.status,
  from: msg.from,
  to: msg.to,
  isAutoReply: autoReplySids.has(msg.sid),
});

router.get("/calls/contact/:phoneNumber", verifyToken, async (req, res) => {
  const { uuid } = req.user;
  const { phoneNumber } = req.params;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({ success: true, calls: [] });
    }

    const client = getTwilioClient();
    const FINAL_STATUSES = ["completed", "no-answer", "busy", "canceled", "failed"];
    const callCacheKey = `thread:${uuid}:${phoneNumber}`;
    const smsCacheKey = `sms-thread:${uuid}:${phoneNumber}`;

    let calls = cacheGet(callCacheKey);
    if (!calls) {
      const [outbound, inbound] = await Promise.all([
        client.calls.list({ from: userPhoneNumber, to: phoneNumber, limit: 100 }).catch(() => []),
        client.calls.list({ from: phoneNumber, to: userPhoneNumber, limit: 100 }).catch(() => []),
      ]);

      calls = [...outbound, ...inbound]
        .filter((c) => FINAL_STATUSES.includes(c.status))
        .sort((a, b) => a.startTime - b.startTime)
        .map((c) => ({
          ...mapCall(c),
          type: "call",
          durationSeconds: parseInt(c.duration) || 0,
        }));
      cacheSet(callCacheKey, calls);
    }

    let rawSmsMessages = cacheGet(smsCacheKey);
    if (!rawSmsMessages) {
      const [outboundSms, inboundSms] = await Promise.all([
        client.messages.list({ from: userPhoneNumber, to: phoneNumber, limit: 100 }).catch(() => []),
        client.messages.list({ from: phoneNumber, to: userPhoneNumber, limit: 100 }).catch(() => []),
      ]);

      rawSmsMessages = [...outboundSms, ...inboundSms].sort(
        (a, b) => new Date(a.dateSent || a.dateCreated) - new Date(b.dateSent || b.dateCreated)
      );
      cacheSet(smsCacheKey, rawSmsMessages);
    }

    const autoReplySids = await getAutoReplySidSet(phoneNumber);
    const smsMessages = rawSmsMessages.map((msg) => mapSms(msg, autoReplySids));

    const enrichedCalls = (await enrichWithSmsStatus(calls)).map((c) => ({ ...c, type: "call" }));
    const allItems = [...enrichedCalls, ...smsMessages].sort(
      (a, b) => new Date(a.startTime) - new Date(b.startTime)
    );

    return res.json({ success: true, calls: allItems });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch contact call thread." });
  }
});

export default router;
