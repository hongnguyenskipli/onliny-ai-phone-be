import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { getTwilioClient, getUserPhoneNumber, mapCall, cacheGet, cacheSet } from "./shared.js";

const router = Router();

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

    let result = calls;
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
    const cacheKey = `thread:${uuid}:${phoneNumber}`;

    let calls = cacheGet(cacheKey);
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
          durationSeconds: parseInt(c.duration) || 0,
        }));
      cacheSet(cacheKey, calls);
    }

    return res.json({ success: true, calls });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch contact call thread." });
  }
});

export default router;
