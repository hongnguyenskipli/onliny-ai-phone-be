import { Router } from "express";
import twilio from "twilio";
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
      const dial = twiml.dial();
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

  let callerId = process.env.TWILIO_PHONE_NUMBER;
  if (identity) {
    callerId = await getCallerIdByEmail(identity);
  }

  if (to) {
    const dial = twiml.dial({ callerId });
    if (to.startsWith("client:")) {
      dial.client(to.replace("client:", ""));
    } else {
      dial.number(to);
    }
  } else {
    twiml.say("No destination provided.");
  }

  return res.type("text/xml").send(twiml.toString());
});

VoiceRouter.get("/available-numbers", verifyToken, async (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const { type = "Local", areaCode, country = "US", limit = 20 } = req.query;

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_APP_SID } = process.env;
  const { phoneNumber } = req.body;
  const { uuid, email } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const { limit = 50, status, search } = req.query;
  const { uuid } = req.user;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({ success: true, data: [], total: 0 });
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const pageLimit = Math.min(parseInt(limit) || 50, 200);

    const [inbound, outbound] = await Promise.all([
      client.calls.list({ to: userPhoneNumber, limit: pageLimit }),
      client.calls.list({ from: userPhoneNumber, limit: pageLimit }),
    ]);

    let calls = [...inbound, ...outbound]
      .sort((a, b) => b.startTime - a.startTime)
      .map(mapCall);

    if (status === "missed") {
      calls = calls.filter(c => c.status === "missed");
    } else if (status === "completed") {
      calls = calls.filter(c => c.status === "completed");
    }

    if (search) {
      const q = search.toLowerCase();
      calls = calls.filter(c =>
        c.callerNumber?.toLowerCase().includes(q) ||
        c.callerName?.toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, data: calls, total: calls.length });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch call logs." });
  }
});

VoiceRouter.get("/calls/stats", verifyToken, async (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const { uuid } = req.user;

  try {
    const userPhoneNumber = await getUserPhoneNumber(uuid);
    if (!userPhoneNumber) {
      return res.json({
        success: true,
        data: { todayCallsCount: 0, missedCallsCount: 0, completedCallsCount: 0, incomingCallsCount: 0, outgoingCallsCount: 0, totalDuration: 0, averageDuration: 0 },
      });
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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

export default VoiceRouter;
