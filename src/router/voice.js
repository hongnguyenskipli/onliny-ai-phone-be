import { Router } from "express";
import https from "https";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";
import { VOICE_BINDINGS_COLLECTION, USER_NUMBERS_COLLECTION, CALL_FORWARDING_COLLECTION } from "../constants/index.js";

const formatDuration = (seconds) => {
  const s = parseInt(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
};

const isMissed = (status) => ["no-answer", "busy", "canceled", "failed"].includes(status);

const mapCall = (call) => ({
  id: call.sid,
  callerName: call.callerName || call.from,
  callerNumber: call.direction === "inbound" ? call.from : call.to,
  status: isMissed(call.status) ? "missed" : call.status,
  startTime: call.startTime?.toISOString() || null,
  duration: formatDuration(call.duration),
  direction: call.direction === "inbound" ? "incoming" : "outgoing",
  hasRecording: false,
});

const getUserPhoneNumber = async (uuid) => {
  if (!uuid) return null;
  const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
  if (doc.exists) return doc.data().phone_number;
  return null;
};

const getCallerIdByEmail = async (email) => {
  try {
    const snapshot = await defaultDB
      .collection(USER_NUMBERS_COLLECTION)
      .where("userEmail", "==", email)
      .limit(1)
      .get();
    if (!snapshot.empty) return snapshot.docs[0].data().phone_number;
  } catch (_) {}
  return process.env.TWILIO_PHONE_NUMBER;
};

const callAmdState = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [sid, state] of callAmdState.entries()) {
    if (state.timestamp < cutoff) callAmdState.delete(sid);
  }
}, 5 * 60 * 1000);

let _twilioClient = null;
const getTwilioClient = () => {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
};

const _cache = new Map();
const CACHE_TTL = 60_000;

const cacheGet = (key) => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
};
const cacheSet = (key, data) => _cache.set(key, {data, ts: Date.now()});

setInterval(() => {
  const cutoff = Date.now() - CACHE_TTL;
  for (const [k, v] of _cache.entries()) {
    if (v.ts < cutoff) _cache.delete(k);
  }
}, 60_000);

const VoiceRouter = Router();

VoiceRouter.get("/token", verifyToken, (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_APP_SID, TWILIO_PUSH_CREDENTIAL_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_APP_SID) {
    return res.status(500).json({ message: "Twilio credentials not configured." });
  }

  const identity = req.user.email;

  const token = new twilio.jwt.AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
    { identity, ttl: 86400 }
  );

  const voiceGrantOptions = {
    outgoingApplicationSid: TWILIO_APP_SID,
    incomingAllow: true,
  };

  if (TWILIO_PUSH_CREDENTIAL_SID) {
    voiceGrantOptions.pushCredentialSid = TWILIO_PUSH_CREDENTIAL_SID;
  }

  const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant(voiceGrantOptions);
  token.addGrant(voiceGrant);

  return res.json({ token: token.toJwt(), identity });
});

VoiceRouter.post("/bind", verifyToken, async (req, res) => {
  const { phoneNumber } = req.body;
  const { email, uuid } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    await defaultDB
      .collection(VOICE_BINDINGS_COLLECTION)
      .doc(phoneNumber)
      .set({ phoneNumber, identity: email, uuid, updatedAt: new Date().toISOString() });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to bind device." });
  }
});

VoiceRouter.post("/incoming", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;

  try {
    let identity = null;

    if (to) {
      const doc = await defaultDB
        .collection(VOICE_BINDINGS_COLLECTION)
        .doc(to)
        .get();

      if (doc.exists) {
        identity = doc.data().identity;
      }
    }

    if (!identity) {
      identity = process.env.TWILIO_CLIENT_IDENTITY;
    }

    if (identity) {
      const dial = twiml.dial({
        record: "record-from-answer-dual",
        recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
      });
      dial.client(identity);
    } else {
      twiml.say("No client registered to receive calls on this number.");
    }
  } catch (err) {
    twiml.say("An error occurred routing your call.");
  }

  return res.type("text/xml").send(twiml.toString());
});

VoiceRouter.post("/outgoing", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const callerRaw = req.body.Caller || "";
  const identity = callerRaw.startsWith("client:") ? callerRaw.slice(7) : null;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const parentCallSid = req.body.CallSid;

  let callerId = process.env.TWILIO_PHONE_NUMBER;
  if (identity) {
    callerId = await getCallerIdByEmail(identity);
  }

  if (to) {
    const dialOptions = {
      callerId,
      record: "do-not-record",
    };

    if (!to.startsWith("client:")) {
      dialOptions.record = "record-from-answer-dual";
      dialOptions.recordingStatusCallback = `${baseUrl}/api/voice/recording-status`;
      dialOptions.recordingStatusCallbackMethod = "POST";

      if (parentCallSid) {
        callAmdState.set(parentCallSid, {
          childCallSid: null,
          humanConnected: false,
          timestamp: Date.now(),
        });
      }
    }

    const dial = twiml.dial(dialOptions);
    if (to.startsWith("client:")) {
      dial.client(to.replace("client:", ""));
    } else {
      dial.number(
        {
          statusCallbackEvent: "answered",
          statusCallback: `${baseUrl}/api/voice/call-answered?parentSid=${parentCallSid}`,
          statusCallbackMethod: "POST",
        },
        to
      );
    }
  } else {
    twiml.say("No destination provided.");
  }

  return res.type("text/xml").send(twiml.toString());
});

VoiceRouter.get("/available-numbers", verifyToken, async (req, res) => {
  const { type = "Local", areaCode, country = "US", limit = 20 } = req.query;

  try {
    const client = getTwilioClient();
    const numberType = type === "TollFree" ? "tollFree" : "local";
    const params = { limit: parseInt(limit) };
    if (numberType === "local" && areaCode) params.areaCode = areaCode;

    const numbers = await client.availablePhoneNumbers(country)[numberType].list(params);
    return res.json({
      success: true,
      data: numbers.map(n => ({
        phone_number: n.phoneNumber,
        friendly_name: n.friendlyName,
        region: n.region || "",
        locality: n.locality || "",
        iso_country: n.isoCountry,
      })),
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch available numbers." });
  }
});

VoiceRouter.get("/my-number", verifyToken, async (req, res) => {
  const { uuid } = req.user;
  try {
    const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
    if (doc.exists) {
      return res.json({ success: true, data: doc.data() });
    }
    return res.json({ success: true, data: null });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch phone number." });
  }
});

VoiceRouter.post("/purchase-number", verifyToken, async (req, res) => {
  const { TWILIO_APP_SID } = process.env;
  const { phoneNumber } = req.body;
  const { uuid, email } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    const client = getTwilioClient();
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceApplicationSid: TWILIO_APP_SID,
    });

    const numberData = {
      uuid,
      userEmail: email,
      phone_number: purchased.phoneNumber,
      friendly_name: purchased.friendlyName,
      sid: purchased.sid,
      region: purchased.region || "",
      locality: purchased.locality || "",
      purchasedAt: new Date().toISOString(),
    };

    const forwardingDefaults = {
      uuid,
      userEmail: email,
      enabled: false,
      forwardingNumber: "",
      forwardOnBusy: true,
      forwardOnNoAnswer: true,
      forwardOnUnreachable: false,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).set(numberData),
      defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(purchased.phoneNumber).set({
        phoneNumber: purchased.phoneNumber,
        identity: email,
        uuid,
        updatedAt: new Date().toISOString(),
      }),
      defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).set(forwardingDefaults, { merge: true }),
    ]);

    return res.json({ success: true, data: numberData });
  } catch (err) {
    return res.status(500).json({ message: "Failed to purchase phone number." });
  }
});

VoiceRouter.get("/forwarding", verifyToken, async (req, res) => {
  const { uuid } = req.user;
  try {
    const doc = await defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).get();
    const defaults = {
      enabled: false,
      forwardingNumber: "",
      forwardOnBusy: true,
      forwardOnNoAnswer: true,
      forwardOnUnreachable: false,
    };
    return res.json({ success: true, data: doc.exists ? doc.data() : defaults });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch forwarding settings." });
  }
});

VoiceRouter.put("/forwarding", verifyToken, async (req, res) => {
  const { uuid, email } = req.user;
  const { enabled, forwardingNumber, forwardOnBusy, forwardOnNoAnswer, forwardOnUnreachable } = req.body;

  try {
    const data = {
      uuid,
      userEmail: email,
      enabled,
      forwardingNumber,
      forwardOnBusy,
      forwardOnNoAnswer,
      forwardOnUnreachable,
      updatedAt: new Date().toISOString(),
    };
    await defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).set(data);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update forwarding settings." });
  }
});

VoiceRouter.get("/calls", verifyToken, async (req, res) => {
  const { limit = 50, status, search } = req.query;
  const { uuid } = req.user;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({ success: true, data: [], total: 0 });
    }

    const client = getTwilioClient();
    const pageLimit = Math.min(parseInt(limit) || 50, 200);
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
      result = result.filter(c => c.status === "missed");
    } else if (status === "completed") {
      result = result.filter(c => c.status === "completed");
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.callerNumber?.toLowerCase().includes(q) ||
        c.callerName?.toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, data: result, total: result.length });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch call logs." });
  }
});

VoiceRouter.get("/calls/stats", verifyToken, async (req, res) => {
  const { uuid } = req.user;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({
        success: true,
        data: { todayCallsCount: 0, missedCallsCount: 0, completedCallsCount: 0, incomingCallsCount: 0, outgoingCallsCount: 0, totalDuration: 0, averageDuration: 0 },
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
        missedCallsCount: all.filter(c => isMissed(c.status)).length,
        completedCallsCount: all.filter(c => c.status === "completed").length,
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

VoiceRouter.get("/calls/contact/:phoneNumber", verifyToken, async (req, res) => {
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
        .filter(c => FINAL_STATUSES.includes(c.status))
        .sort((a, b) => a.startTime - b.startTime)
        .map(c => ({
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

VoiceRouter.get("/calls/:callSid/amd-state", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  const state = callAmdState.get(callSid);

  if (state?.humanConnected) {
    return res.json({ success: true, data: state });
  }

  try {
    const client = getTwilioClient();
    const childCalls = await client.calls.list({ parentCallSid: callSid, limit: 1 });

    if (childCalls.length > 0 && childCalls[0].status === "in-progress") {
      const childCall = childCalls[0];
      const newState = {
        ...(state || {}),
        childCallSid: childCall.sid,
        humanConnected: true,
        timestamp: state?.timestamp || Date.now(),
      };
      callAmdState.set(callSid, newState);
      return res.json({ success: true, data: newState });
    }
  } catch (_) {}

  return res.json({ success: true, data: state || null });
});

VoiceRouter.post("/calls/:callSid/recordings/start", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  try {
    const client = getTwilioClient();
    const recording = await client.calls(callSid).recordings.create({
      recordingChannels: "dual",
    });
    return res.json({ success: true, recordingSid: recording.sid });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to start recording." });
  }
});

VoiceRouter.post("/recordings/:recordingSid/stop", verifyToken, async (req, res) => {
  const { recordingSid } = req.params;

  try {
    const client = getTwilioClient();
    await client.recordings(recordingSid).update({ status: "stopped" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to stop recording." });
  }
});

VoiceRouter.post("/recording-status", (req, res) => {
  res.sendStatus(204);
});

VoiceRouter.post("/call-answered", async (req, res) => {
  const { CallStatus, CallSid } = req.body;
  const parentSid = req.query.parentSid;

  res.sendStatus(204);

  if (CallStatus !== "in-progress" || !parentSid) return;

  const existing = callAmdState.get(parentSid) || {};
  callAmdState.set(parentSid, {
    ...existing,
    childCallSid: CallSid,
    humanConnected: true,
    timestamp: existing.timestamp || Date.now(),
  });
});

VoiceRouter.post("/amd-status", (req, res) => {
  res.sendStatus(204);
});

VoiceRouter.get("/calls/:callSid/recordings", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  try {
    const client = getTwilioClient();

    const [directRecordings, callDetails] = await Promise.all([
      client.calls(callSid).recordings.list().catch(() => []),
      client.calls(callSid).fetch().catch(() => null),
    ]);

    let parentRecordings = [];
    if (callDetails?.parentCallSid) {
      parentRecordings = await client.calls(callDetails.parentCallSid).recordings.list().catch(() => []);
    }

    const seenSids = new Set();
    const allRecordings = [...directRecordings, ...parentRecordings].filter((r) => {
      if (seenSids.has(r.sid)) return false;
      seenSids.add(r.sid);
      return true;
    });

    const mapped = allRecordings.map((r) => ({
      sid: r.sid,
      duration: parseInt(r.duration) || 0,
      dateCreated: r.dateCreated?.toISOString() || null,
      channels: r.channels,
      source: r.source,
    }));

    return res.json({ success: true, recordings: mapped });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch recordings." });
  }
});

VoiceRouter.get("/recordings/:recordingSid/stream", async (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const { recordingSid } = req.params;
  const { token } = req.query;

  const authHeader = req.headers.authorization;
  let verified = false;

  try {
    if (token) {
      jwt.verify(token, process.env.JWT_SECRET);
      verified = true;
    } else if (authHeader?.startsWith("Bearer ")) {
      jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
      verified = true;
    }
  } catch (_) {}

  if (!verified) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const upstreamHeaders = { Authorization: `Basic ${auth}` };
  if (req.headers.range) {
    upstreamHeaders["Range"] = req.headers.range;
  }

  const proxyReq = https.request(twilioUrl, { headers: upstreamHeaders }, (twilioRes) => {
    const statusCode = twilioRes.statusCode || 200;
    res.status(statusCode);
    res.setHeader("Content-Type", twilioRes.headers["content-type"] || "audio/mpeg");
    res.setHeader("Content-Disposition", `inline; filename="${recordingSid}.mp3"`);
    res.setHeader("Accept-Ranges", "bytes");
    if (twilioRes.headers["content-length"]) {
      res.setHeader("Content-Length", twilioRes.headers["content-length"]);
    }
    if (twilioRes.headers["content-range"]) {
      res.setHeader("Content-Range", twilioRes.headers["content-range"]);
    }
    twilioRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ message: "Failed to stream recording." });
    }
  });

  proxyReq.end();
});

export default VoiceRouter;
