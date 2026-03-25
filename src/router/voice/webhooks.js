import { Router } from "express";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION, USER_NUMBERS_COLLECTION, CALL_RESULTS_COLLECTION } from "../../constants/index.js";
import { getCallerIdByIdentity, callAmdState, isMissed, sendSMS, markSmsSentForCall, markCallMissed, markCallerMissed, isSmsSentForCall } from "./shared.js";
import { verifyToken } from "../../middleware/verifyToken.js";
import { getAutoReplyByPhoneNumber } from "../../lib/Services/AutoReply/index.js";
import { sendPushToUser } from "../../lib/pushNotification.js";

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

router.all("/recording-status", async (req, res) => {
  res.sendStatus(204);

  const params = { ...req.query, ...req.body };
  const { RecordingSid, RecordingUrl, CallSid, RecordingStatus } = params;
  console.log(`[RECORDING] CallSid=${CallSid} RecordingSid=${RecordingSid} Status=${RecordingStatus}`);

  if (RecordingSid && CallSid && RecordingStatus === "completed") {
    try {
      await defaultDB.collection(CALL_RESULTS_COLLECTION).doc(CallSid).set(
        { callSid: CallSid, recordingSid: RecordingSid, recordingUrl: RecordingUrl, recordedAt: new Date().toISOString() },
        { merge: true }
      );
      console.log(`[RECORDING] Saved recording ${RecordingSid} for call ${CallSid}`);
    } catch (err) {
      console.error("[RECORDING] Save failed:", err.message);
    }

    // Send push notification to the number owner
    try {
      const toNumber = params.To || params.to;
      if (toNumber) {
        const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(toNumber).get();
        if (binding.exists) {
          await sendPushToUser(binding.data().uuid, { type: "call_update", contactNumber: params.From || params.from || "" });
          console.log(`[RECORDING] Push sent for recording completion`);
        }
      }
    } catch (err) {
      console.error("[RECORDING] Push failed:", err.message);
    }
  }
});

router.all("/call-answered", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const { CallStatus, CallSid } = params;
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

const DEFAULT_MISSED_MSG = "Hi! Sorry we missed your call — we'll get back to you as soon as possible. Thank you!";

router.all("/call-status", async (req, res) => {
  res.sendStatus(204);
});

router.all("/dial-action", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  res.type("text/xml").send(twiml.toString());

  const params = { ...req.query, ...req.body };
  const { DialCallStatus, CallSid, Direction, From, To } = params;
  const myNumber = req.query.myNumber;

  console.log(`[DIAL-ACTION] Called: DialCallStatus=${DialCallStatus} Direction=${Direction} From=${From} To=${To} CallSid=${CallSid} myNumber=${myNumber}`);

  const isIncoming = Direction === "inbound";

  if (!isMissed(DialCallStatus)) {
    console.log(`[DIAL-ACTION] Not missed (status=${DialCallStatus}), skipping SMS`);

    // For completed calls, send push notification to update frontend
    if (DialCallStatus === "completed") {
      try {
        const ownerNumber = isIncoming ? To : myNumber;
        if (ownerNumber) {
          const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(ownerNumber).get();
          if (binding.exists) {
            const contactNum = isIncoming ? From : To;
            await sendPushToUser(binding.data().uuid, { type: "call_update", contactNumber: contactNum });
            console.log(`[DIAL-ACTION] Push sent for completed call`);
          }
        }
      } catch (err) {
        console.error("[DIAL-ACTION] Push error:", err.message);
      }
    }
    return;
  }

  await markCallMissed(CallSid);

  // isIncoming already computed above

  // Only send auto-reply for incoming missed calls
  if (!isIncoming) {
    console.log(`[DIAL-ACTION] Outgoing missed call, skipping SMS`);
    return;
  }

  const smsTo = From;

  console.log(`[DIAL-ACTION] Missed call. smsTo=${smsTo}`);

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
    const autoReply = await getAutoReplyByPhoneNumber({ phoneNumber: To });

    if (!autoReply || autoReply.enabled === false) {
      console.log(`[DIAL-ACTION] Auto-reply disabled or not found for ${To}, skipping SMS`);
      return;
    }

    const smsBody = autoReply.missedCallMessage || DEFAULT_MISSED_MSG;

    console.log(`[DIAL-ACTION] Sending SMS to ${smsTo}...`);
    const message = await sendSMS(smsTo, smsBody);
    const smsSid = message.sid;
    console.log(`[SMS] Incoming missed → Sent to ${smsTo}, SID: ${smsSid}`);

    _smsSentCache.set(cacheKey, Date.now());
    _smsSentCache.set(recentKey, Date.now());
    await markSmsSentForCall(CallSid, From, To, smsSid);

    // Send push notification to user
    const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(To).get();
    if (binding.exists) {
      await sendPushToUser(binding.data().uuid, {
        type: "call_update",
        contactNumber: From,
      });
    }
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

  // Check if SMS was already sent by dial-action webhook
  if (callSid) {
    const alreadySent = await isSmsSentForCall(callSid);
    if (alreadySent) {
      console.log(`[MISSED-SMS] Already sent by dial-action for ${callSid}, skipping`);
      return res.json({ success: true, sid: "already-sent" });
    }
  }

  try {
    markCallerMissed(callerNumber);
    if (callSid) {
      await markCallMissed(callSid);
    }

    // Look up user's auto-reply message
    const { uuid } = req.user;
    const { getUserPhoneNumber } = await import("./shared.js");
    const userPhone = await getUserPhoneNumber(uuid);
    const autoReply = userPhone ? await getAutoReplyByPhoneNumber({ phoneNumber: userPhone }) : null;
    const smsBody = autoReply?.missedCallMessage || DEFAULT_MISSED_MSG;

    const message = await sendSMS(callerNumber, smsBody);
    console.log(`[MISSED-SMS] Sent to ${callerNumber}, SID: ${message.sid}`);

    if (callSid) {
      await markSmsSentForCall(callSid, callerNumber, null, message.sid);
    }

    return res.json({ success: true, sid: message.sid });
  } catch (err) {
    console.error(`[MISSED-SMS] Failed:`, err.message);
    return res.status(500).json({ message: "Failed to send missed call SMS" });
  }
});

export default router;
