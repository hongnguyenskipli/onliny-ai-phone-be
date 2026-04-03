import { Router } from "express";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION, USER_NUMBERS_COLLECTION, CALL_RESULTS_COLLECTION } from "../../constants/index.js";
import { getCallerIdByIdentity, callAmdState, isMissed, sendSMS, markSmsSentForCall, markCallMissed, markCallerMissed, isSmsSentForCall, isCallRejected, markCallRejected, cacheDelete, cacheInvalidateByPrefix } from "./shared.js";
import { verifyToken } from "../../middleware/verifyToken.js";
import { getAutoReplyByPhoneNumber } from "../../lib/Services/AutoReply/index.js";
import { sendPushToUser } from "../../lib/pushNotification.js";
import { emitToUser } from "../../lib/socketHandler.js";

const router = Router();

router.post("/handler", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const params = { ...req.query, ...req.body };
  const direction = params.Direction;
  const to = params.To;
  const from = params.From;
  
 
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.get("host");
  const baseUrl = process.env.SERVER_BASE_URL || `${protocol}://${host}`;
  
  const parentCallSid = params.CallSid;

  console.log(`[VOICE_HANDLER] Incoming request: Direction=${direction}, To=${to}, From=${from}, BaseUrl=${baseUrl}`);

  try {
    const isClientOutbound = from && from.startsWith("client:");

    if (direction === "outbound-api" || direction === "outbound-dial" || isClientOutbound) {
      // Logic Outbound (Đã chạy tốt)
      const identity = isClientOutbound ? from.slice(7) : null;
      let callerId = process.env.TWILIO_PHONE_NUMBER;

      if (identity) {
        callerId = await getCallerIdByIdentity(identity);
      }

      if (to) {
        console.log(`[OUTBOUND] Routing call from identity=${identity} to ${to} using callerId=${callerId}`);

        let targetIdentity = null;
        if (!to.startsWith("client:")) {
          const doc = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(to).get();
          if (doc.exists) {
            targetIdentity = doc.data().identity;
            console.log(`[OUTBOUND] Intercepted in-app call target: ${targetIdentity}`);
          }
        }

        const dialOptions = {
          callerId,
          record: "do-not-record",
        };

        if (!to.startsWith("client:") && !targetIdentity) {
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
        } else if (targetIdentity || to.startsWith("client:")) {
          // Keep dial-action for client-to-client for CDR logging
          dialOptions.action = `${baseUrl}/api/voice/dial-action?myNumber=${encodeURIComponent(callerId)}`;
          dialOptions.method = "POST";
        }

        const dial = twiml.dial(dialOptions);
        if (targetIdentity) {
          dial.client(targetIdentity);
        } else if (to.startsWith("client:")) {
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
    } else if (direction === "inbound") {
      // Logic Inbound - Kiểm tra kỹ Identity
      let identity = null;
      const dialActionUrl = `${baseUrl}/api/voice/dial-action`;

      if (to) {
        console.log(`[INBOUND] Looking up owner for number: ${to}`);
        const doc = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(to).get();
        if (doc.exists) {
          identity = doc.data().identity;
          console.log(`[INBOUND] Found identity: ${identity}`);
        } else {
          console.log(`[INBOUND] No DB record for ${to}, checking fallback identity`);
        }
      }

      if (!identity) {
        identity = process.env.TWILIO_CLIENT_IDENTITY;
        console.log(`[INBOUND] Using process.env identity: ${identity}`);
      }

      if (identity) {
        console.log(`[INBOUND] Dialing client: ${identity}`);
        const dial = twiml.dial({
          action: dialActionUrl,
          method: "POST",
          timeout: 45,
          record: "record-from-answer-dual",
          recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
          recordingStatusCallbackMethod: "POST",
        });
        dial.client(identity);
      } else {
        console.error(`[INBOUND] Error: No identity found for ${to}`);
        twiml.say("Sorry, the recipient is not available at this moment.");
      }
    } else {
      console.log(`[VOICE_HANDLER] Unknown direction: ${direction}.`);
      twiml.say("Unsupported call direction.");
    }
  } catch (err) {
    console.error(`[VOICE_HANDLER] CRITICAL ERROR:`, err.stack);
    twiml.say("An internal server error occurred.");
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
const MAX_SMS_CACHE_SIZE = 200;

setInterval(() => {
  const cutoff = Date.now() - SMS_CACHE_TTL;
  for (const [key, timestamp] of _smsSentCache.entries()) {
    if (timestamp < cutoff) _smsSentCache.delete(key);
  }
}, 60 * 60 * 1000);

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
        const cleanTo = To ? To.replace('client:', '') : '';
        const cleanFrom = From ? From.replace('client:', '') : '';
        const cleanMyNumber = myNumber ? myNumber.replace('client:', '') : '';
        
        const ownerNumber = isIncoming ? cleanTo : cleanMyNumber;
        if (ownerNumber) {
          const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(ownerNumber).get();
          if (binding.exists) {
            const uuid = binding.data().uuid;
            const contactNum = isIncoming ? cleanFrom : cleanTo;
            await sendPushToUser(uuid, { type: "call_update", contactNumber: contactNum });
            emitToUser(uuid, "call_status_changed", { contactNumber: contactNum });
            cacheInvalidateByPrefix(`calls:${uuid}`);
            cacheInvalidateByPrefix(`thread:${uuid}`);
            console.log(`[DIAL-ACTION] Push & Socket sent for completed call`);
          }
        }
      } catch (err) {
        console.error("[DIAL-ACTION] Push error:", err.message);
      }
    }
    return;
  }

  await markCallMissed(CallSid);

  // Send push notification for missed call (whether or not auto-reply is sent)
  try {
    const cleanTo = To ? To.replace('client:', '') : '';
    const cleanFrom = From ? From.replace('client:', '') : '';
    const cleanMyNumber = myNumber ? myNumber.replace('client:', '') : '';

    const ownerNumber = isIncoming ? cleanTo : cleanMyNumber;
    if (ownerNumber) {
      const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(ownerNumber).get();
      if (binding.exists) {
        const uuid = binding.data().uuid;
        const contactNum = isIncoming ? cleanFrom : cleanTo;
        await sendPushToUser(uuid, { type: "call_update", contactNumber: contactNum });
        emitToUser(uuid, "call_status_changed", { contactNumber: contactNum });
        cacheInvalidateByPrefix(`calls:${uuid}`);
        cacheInvalidateByPrefix(`thread:${uuid}`);
        console.log(`[DIAL-ACTION] Push & Socket sent for missed call`);
      }
    }
  } catch (err) {
    console.error("[DIAL-ACTION] Push error for missed call:", err.message);
  }

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

  // Skip auto-reply if user explicitly rejected (denied) the call
  if (await isCallRejected(CallSid)) {
    console.log(`[DIAL-ACTION] Call was rejected by user, skipping auto-reply SMS`);
    return;
  }

  // Also check for DialCallStatus=busy which usually means user tapped Deny
  if (DialCallStatus === "busy") {
    console.log(`[DIAL-ACTION] DialCallStatus=busy (likely user denied), skipping auto-reply SMS`);
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

    // Send SMS from the dialed Twilio number to the caller
    console.log(`[DIAL-ACTION] Sending auto-reply SMS to ${smsTo} from ${To}...`);
    const message = await sendSMS(smsTo, smsBody, To);
    const smsSid = message.sid;
    console.log(`[SMS] Incoming missed → Sent to ${smsTo}, SID: ${smsSid}`);

    _smsSentCache.set(cacheKey, Date.now());
    _smsSentCache.set(recentKey, Date.now());
    // Evict oldest if cache exceeds max size
    while (_smsSentCache.size > MAX_SMS_CACHE_SIZE) {
      const oldestKey = _smsSentCache.keys().next().value;
      _smsSentCache.delete(oldestKey);
    }
    await markSmsSentForCall(CallSid, From, To, smsSid);

    // Send push notification to user
    const binding = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(To).get();
    if (binding.exists) {
      const uuid = binding.data().uuid;
      cacheDelete(`sms-thread:${uuid}:${smsTo}`);
      await sendPushToUser(uuid, {
        type: "call_update",
        contactNumber: From,
      });
      emitToUser(uuid, "new_message", {
        contactNumber: smsTo,
        direction: "outgoing",
        body: smsBody,
        sid: smsSid,
        source: "auto_reply",
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

    // Send SMS from the user's Twilio number
    const message = await sendSMS(callerNumber, smsBody, userPhone);
    console.log(`[MISSED-SMS] Sent to ${callerNumber} from ${userPhone}, SID: ${message.sid}`);

    if (callSid) {
      await markSmsSentForCall(callSid, callerNumber, null, message.sid);
    }

    return res.json({ success: true, sid: message.sid });
  } catch (err) {
    console.error(`[MISSED-SMS] Failed:`, err.message);
    return res.status(500).json({ message: "Failed to send missed call SMS" });
  }
});

// Mark a call as rejected (user tapped Deny) — prevents auto-reply SMS
router.post("/calls/mark-rejected", verifyToken, async (req, res) => {
  const { callSid } = req.body;
  if (!callSid) {
    return res.status(400).json({ message: "Missing callSid" });
  }
  await markCallRejected(callSid);
  console.log(`[REJECT] CallSid=${callSid} marked as rejected by user`);
  return res.json({ success: true });
});

export default router;
