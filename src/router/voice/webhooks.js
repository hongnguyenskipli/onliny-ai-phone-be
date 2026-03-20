import { Router } from "express";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION, USER_NUMBERS_COLLECTION } from "../../constants/index.js";
import { getCallerIdByIdentity, callAmdState, isMissed, sendSMS, markSmsSentForCall, markCallMissed } from "./shared.js";
import { verifyToken } from "../../middleware/verifyToken.js";

const router = Router();

router.post("/incoming", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const from = req.body.From;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const dialActionUrl = `${baseUrl}/api/voice/dial-action`;

  console.log(`[INCOMING] From=${from} To=${to} baseUrl=${baseUrl} dialAction=${dialActionUrl}`);

  try {
    let identity = null;

    if (to) {
      const doc = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(to).get();
      if (doc.exists) {
        identity = doc.data().identity;
      } else {
        console.log(`[INCOMING] No DB record for ${to}, using fallback identity`);
      }
    }

    if (!identity) {
      identity = process.env.TWILIO_CLIENT_IDENTITY;
    }

    console.log(`[INCOMING] Routing to identity=${identity}`);

    if (identity) {
      const dial = twiml.dial({
        action: dialActionUrl,
        method: "POST",
        record: "record-from-answer-dual",
        recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
      });
      dial.client(identity);
    } else {
      twiml.say("No client registered to receive calls on this number.");
    }
  } catch (err) {
    console.error(`[INCOMING] Error:`, err.message);
    twiml.say("An error occurred routing your call.");
  }

  return res.type("text/xml").send(twiml.toString());
});

router.post("/outgoing", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const callerRaw = req.body.Caller || "";
  const identity = callerRaw.startsWith("client:") ? callerRaw.slice(7) : null;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const parentCallSid = req.body.CallSid;

  try {
    let callerId = process.env.TWILIO_PHONE_NUMBER;
    if (identity) {
      callerId = await getCallerIdByIdentity(identity);
    }

    if (to) {
      const dialOptions = {
        callerId,
        record: "do-not-record",
      };

      if (!to.startsWith("client:")) {
        dialOptions.action = `${baseUrl}/api/voice/dial-action?myNumber=${encodeURIComponent(callerId)}`;
        dialOptions.method = "POST";
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
  } catch (err) {
    console.error("[OUTGOING] Error building TwiML:", err.message);
    twiml.say("An error occurred.");
  }

  return res.type("text/xml").send(twiml.toString());
});

router.post("/recording-status", (req, res) => {
  res.sendStatus(204);
});

router.post("/call-answered", async (req, res) => {
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

const _smsSentCache = new Map();
const SMS_CACHE_TTL = 5 * 60 * 1000;

const getMissedCallMessage = () => {
  return `Hiện tại tôi bận không thể nghe cuộc gọi. Vui lòng gọi lại lúc mấy giờ vậy đó`;
};

const getOutgoingMissedMessage = () => {
  return `Hiện tại tôi bận không thể nghe cuộc gọi. Vui lòng gọi lại lúc mấy giờ vậy đó`;
};

router.post("/call-status", async (req, res) => {
  res.sendStatus(204);
});

router.post("/dial-action", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  res.type("text/xml").send(twiml.toString());

  const { DialCallStatus, CallSid, Direction, From, To } = req.body;
  const myNumber = req.query.myNumber;

  console.log(`[DIAL-ACTION] Called: DialCallStatus=${DialCallStatus} Direction=${Direction} From=${From} To=${To} CallSid=${CallSid} myNumber=${myNumber}`);

  if (!isMissed(DialCallStatus)) {
    console.log(`[DIAL-ACTION] Not missed (status=${DialCallStatus}), skipping SMS`);
    return;
  }

  await markCallMissed(CallSid);

  const isIncoming = Direction === "inbound";
  const smsTo = isIncoming ? From : myNumber;

  console.log(`[DIAL-ACTION] Missed call. isIncoming=${isIncoming} smsTo=${smsTo}`);

  if (!smsTo || smsTo.startsWith("client:")) {
    console.log(`[DIAL-ACTION] Invalid smsTo="${smsTo}", aborting`);
    return;
  }

  const cacheKey = `${From}:${To}:${CallSid}`;
  if (_smsSentCache.has(cacheKey)) {
    console.log(`[DIAL-ACTION] Cache hit (callSid), skipping SMS`);
    return;
  }

  const recentKey = `${From}:${To}`;
  const lastSent = _smsSentCache.get(recentKey);
  if (lastSent && Date.now() - lastSent < SMS_CACHE_TTL) {
    console.log(`[DIAL-ACTION] Cache hit (recent ${Math.round((Date.now()-lastSent)/1000)}s ago), skipping SMS`);
    return;
  }

  try {
    let smsSid;

    if (isIncoming) {
      console.log(`[DIAL-ACTION] Sending SMS to caller ${smsTo}...`);
      const message = await sendSMS(smsTo, getMissedCallMessage());
      smsSid = message.sid;
      console.log(`[SMS] Incoming missed → Sent to caller ${smsTo}, SID: ${smsSid}`);
    } else {
      console.log(`[DIAL-ACTION] Sending SMS to me ${smsTo}...`);
      const message = await sendSMS(smsTo, getOutgoingMissedMessage());
      smsSid = message.sid;
      console.log(`[SMS] Outgoing missed → Sent to me ${smsTo}, SID: ${smsSid}`);
    }

    _smsSentCache.set(cacheKey, Date.now());
    _smsSentCache.set(recentKey, Date.now());
    await markSmsSentForCall(CallSid, From, To, smsSid);
  } catch (err) {
    console.error(`[SMS] Failed to send SMS:`, err.message);
  }
});

router.post("/amd-status", (req, res) => {
  res.sendStatus(204);
});

router.post("/calls/missed-sms", verifyToken, async (req, res) => {
  const { callerNumber, callSid } = req.body;

  if (!callerNumber) {
    return res.status(400).json({ message: "Missing callerNumber" });
  }

  console.log(`[MISSED-SMS] callerNumber=${callerNumber} callSid=${callSid}`);

  try {
    if (callSid) {
      await markCallMissed(callSid);
    }

    const message = await sendSMS(callerNumber, getMissedCallMessage());
    console.log(`[MISSED-SMS] Sent to ${callerNumber}, SID: ${message.sid}`);

    return res.json({ success: true, sid: message.sid });
  } catch (err) {
    console.error(`[MISSED-SMS] Failed:`, err.message);
    return res.status(500).json({ message: "Failed to send missed call SMS" });
  }
});

export default router;
