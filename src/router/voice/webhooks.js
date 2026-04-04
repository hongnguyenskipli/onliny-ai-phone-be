import { Router } from "express";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { voiceService } from "../../lib/Services/Voice/voiceService.js";
import { getAutoReplyByPhoneNumber } from "../../lib/Services/AutoReply/index.js";
import { isValidE164, sendSMS, cacheGet, cacheSet, getUserPhoneNumber } from "./shared.js";
import { sentMessageSids } from "./sms.js";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { FieldValue } from "firebase-admin/firestore";

const router = Router();

/* ================= CONFIGURATION ================= */

const CONFIG = {
  CALL_TIMEOUT: 30,
  MAX_SMS_LENGTH: 1600,
  WEBHOOK_TTL_DAYS: 7,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
  RATE_LIMIT_MAX: 100,
};

// Simple in-memory rate limiter
const rateLimitStore = new Map();

/* ================= MIDDLEWARE ================= */

/**
 * Rate limiting middleware for webhooks
 */
const rateLimit = (req, res, next) => {
  const identifier = req.body?.MessageSid || req.body?.CallSid || req.ip;
  const now = Date.now();
  
  const record = rateLimitStore.get(identifier) || { count: 0, resetAt: now + CONFIG.RATE_LIMIT_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + CONFIG.RATE_LIMIT_WINDOW;
  }
  
  record.count++;
  rateLimitStore.set(identifier, record);
  
  if (record.count > CONFIG.RATE_LIMIT_MAX) {
    console.warn(`[RATE LIMIT] Blocked ${identifier}`);
    return res.sendStatus(429);
  }
  
  next();
};

/**
 * Twilio webhook validator with better error handling
 */
const twilioValidator = (req, res, next) => {
  // Always validate webhooks, even in development
  const validator = twilio.webhook({
    validate: true,
    // Allow disabling for local testing with ngrok
    ...(process.env.DISABLE_TWILIO_VALIDATION === 'true' && { validate: false })
  });
  
  validator(req, res, (err) => {
    if (err) {
      console.error('[WEBHOOK] Validation failed:', err.message);
      return res.sendStatus(403);
    }
    next();
  });
};

/* ================= HELPERS ================= */

/**
 * Map Twilio status to app status
 */
const mapTwilioStatus = (status, direction = "outbound") => {
  const normalizedStatus = status?.toLowerCase();

  if (direction === "inbound") {
    switch (normalizedStatus) {
      case "receiving":
        return "sending";
      case "received":
        return "delivered";
      default:
        return "delivered";
    }
  }

  switch (normalizedStatus) {
    case "accepted":
    case "queued":
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
      return "failed";
    case "failed":
      return "failed";
    default:
      console.warn(`[SMS] Unknown status: ${status}`);
      return "sending";
  }
};

/**
 * Atomic webhook deduplication using Firestore transaction
 */
const checkAndMarkWebhook = async (webhookId, type, data) => {
  const docRef = defaultDB
    .collection("webhook_logs")
    .doc(`${type}_${webhookId}`);

  try {
    const result = await defaultDB.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      
      if (doc.exists) {
        return { processed: true, existed: true };
      }

      transaction.set(docRef, {
        webhookId,
        type,
        data,
        processedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + CONFIG.WEBHOOK_TTL_DAYS * 24 * 60 * 60 * 1000),
      });

      return { processed: false, existed: false };
    });

    return result.processed;
  } catch (err) {
    console.error('[WEBHOOK] Transaction failed:', err);
    // Fail closed - prevent duplicate processing
    return true;
  }
};

/**
 * Extract media URLs from MMS
 */
const extractMediaUrls = (reqBody) => {
  const numMedia = parseInt(reqBody.NumMedia) || 0;
  const mediaUrls = [];

  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = reqBody[`MediaUrl${i}`];
    const mediaType = reqBody[`MediaContentType${i}`];

    if (mediaUrl) {
      mediaUrls.push({
        url: mediaUrl,
        contentType: mediaType,
        index: i,
      });
    }
  }

  return mediaUrls;
};

/**
 * Check if user opted out (with caching)
 */
const isOptedOut = async (phoneNumber) => {
  const cacheKey = `opt_out:${phoneNumber}`;
  const cached = cacheGet(cacheKey);
  
  if (cached !== null) return cached;

  try {
    const doc = await defaultDB
      .collection("sms_opt_outs")
      .doc(phoneNumber)
      .get();
    
    const optedOut = doc.exists;
    cacheSet(cacheKey, optedOut);
    return optedOut;
  } catch (err) {
    console.warn('[SMS] Failed to check opt-out status:', err);
    return false; // Fail open
  }
};

/**
 * Handle opt-out/opt-in
 */
const handleOptOut = async (phoneNumber, optOutType, body) => {
  try {
    if (optOutType === "STOP") {
      await defaultDB.collection("sms_opt_outs").doc(phoneNumber).set({
        phoneNumber,
        optedOutAt: FieldValue.serverTimestamp(),
        lastMessage: body,
      });
      
      // Invalidate cache
      cacheSet(`opt_out:${phoneNumber}`, true);
      
      console.log(`[SMS] User opted out: ${phoneNumber}`);
      return true;
    }

    if (optOutType === "START") {
      await defaultDB.collection("sms_opt_outs").doc(phoneNumber).delete();
      
      // Invalidate cache
      cacheSet(`opt_out:${phoneNumber}`, false);
      
      console.log(`[SMS] User opted in: ${phoneNumber}`);
      return false;
    }

    return false;
  } catch (err) {
    console.error('[SMS] Failed to handle opt-out:', err);
    return false;
  }
};

/**
 * Get or create call log document
 */
const getCallLogRef = (callSid) => {
  return defaultDB.collection("call_logs").doc(callSid);
};

/**
 * Check if client is online/registered
 */
const isClientOnline = async (uuid) => {
  try {
    const binding = await voiceService.getVoiceBinding(uuid);
    return binding && binding.identity;
  } catch (err) {
    console.error('[VOICE] Error checking client status:', err);
    return false;
  }
};

/**
 * Sanitize message body
 */
const sanitizeBody = (body) => {
  if (typeof body !== 'string') return '';
  return body.substring(0, CONFIG.MAX_SMS_LENGTH).trim();
};

/* ================= VOICE HANDLER ================= */

router.post(
  "/handler",
  rateLimit,
  twilioValidator,
  async (req, res) => {
    const { From, To, CallSid, CallerName } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();

    console.log(`[VOICE] Handler called: ${CallSid} | From: ${From} | To: ${To}`);

    try {
      /**
       * CASE 1: Outbound Call (From Twilio Client)
       */
      if (From && From.startsWith("client:")) {
        console.log(`[VOICE] Outbound call from client: ${From} to ${To}`);
        
        if (!To || !isValidE164(To)) {
          console.warn(`[VOICE] Invalid destination: ${To}`);
          twiml.say("The destination number is invalid. Please check and try again.");
          twiml.hangup();
          return res.type("text/xml").send(twiml.toString());
        }

        // Get the user's registered phone number for caller ID
        const clientUuid = From.replace("client:", "").replace(/_/g, "-");
        const userPhone = await getUserPhoneNumber(clientUuid) 
          || req.body.FromNumber;

        if (!userPhone || !isValidE164(userPhone)) {
          console.warn(`[VOICE] No valid caller ID for ${clientUuid}`);
          twiml.say("Unable to place call. Please contact support.");
          twiml.hangup();
          return res.type("text/xml").send(twiml.toString());
        }

        // Log outbound call
        await getCallLogRef(CallSid).set({
          callSid: CallSid,
          from: userPhone,
          to: To,
          direction: "outbound",
          status: "initiated",
          timestamp: FieldValue.serverTimestamp(),
        });

        const dial = twiml.dial({
          callerId: userPhone,
          answerOnBridge: true,
          timeout: CONFIG.CALL_TIMEOUT,
          record: req.body.Record || "do-not-record",
        });
        
        dial.number(To);
        
        return res.type("text/xml").send(twiml.toString());
      }

      /**
       * CASE 2: Inbound Call (From PSTN)
       */
      const targetUuid = await voiceService.getUuidByPhone(To);

      if (!targetUuid) {
        console.warn(`[VOICE] No user mapping for: ${To}`);
        twiml.say("This number is not currently registered.");
        twiml.hangup();
        
        // Log rejected call
        await getCallLogRef(CallSid).set({
          callSid: CallSid,
          from: From,
          to: To,
          direction: "inbound",
          status: "rejected",
          reason: "no_user_mapping",
          timestamp: FieldValue.serverTimestamp(),
        });
        
        return res.type("text/xml").send(twiml.toString());
      }

      // Format client identity
      const clientIdentity = targetUuid.replace(/-/g, "_");

      // Check if client is online
      const online = await isClientOnline(targetUuid);
      
      if (!online) {
        console.warn(`[VOICE] Client offline: ${targetUuid}`);
        // Could implement voicemail here
        twiml.say("The person you are trying to reach is currently unavailable.");
        twiml.hangup();
        
        await getCallLogRef(CallSid).set({
          callSid: CallSid,
          from: From,
          to: To,
          targetUuid,
          direction: "inbound",
          status: "client_offline",
          timestamp: FieldValue.serverTimestamp(),
        });
        
        return res.type("text/xml").send(twiml.toString());
      }

      // Send push notification to wake app
      await voiceService.sendCallPush(targetUuid, {
        callSid: CallSid,
        from: From,
        to: To,
        callerName: CallerName || From,
      }).catch(err => {
        console.error(`[VOICE] Push notification failed:`, err);
        // Continue anyway - client might be in foreground
      });

      // Log inbound call
      await getCallLogRef(CallSid).set({
        callSid: CallSid,
        from: From,
        to: To,
        targetUuid,
        direction: "inbound",
        status: "ringing",
        timestamp: FieldValue.serverTimestamp(),
      });

      // Dial the client
      const dial = twiml.dial({
        timeout: CONFIG.CALL_TIMEOUT,
        action: `/api/voice/webhooks/call-status?ownerUuid=${targetUuid}&callSid=${CallSid}`,
        answerOnBridge: false, // Ring immediately
      });
      
      dial.client(clientIdentity);

      return res.type("text/xml").send(twiml.toString());

    } catch (err) {
      console.error("[VOICE HANDLER ERROR]:", err);
      
      twiml.say("An error occurred while connecting your call. Please try again later.");
      twiml.hangup();
      
      // Log error
      await getCallLogRef(CallSid).set({
        callSid: CallSid,
        from: From,
        to: To,
        direction: From?.startsWith("client:") ? "outbound" : "inbound",
        status: "error",
        error: err.message,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(console.error);
      
      return res.type("text/xml").send(twiml.toString());
    }
  }
);

/**
 * Call Status Callback - Handles call completion and auto-reply
 */
router.post(
  "/call-status",
  rateLimit,
  twilioValidator,
  async (req, res) => {
    const { CallSid, From, To, DialCallStatus, CallDuration } = req.body;
    const { ownerUuid, callSid } = req.query;

    // Use callSid from query if available (more reliable)
    const actualCallSid = callSid || CallSid;

    console.log(`[VOICE STATUS] ${actualCallSid} ended: ${DialCallStatus}`);

    try {
      // Check for duplicate
      if (await checkAndMarkWebhook(`${actualCallSid}_${DialCallStatus}`, "call_status", req.body)) {
        console.log(`[VOICE STATUS] Duplicate webhook: ${actualCallSid}`);
        return res.sendStatus(200);
      }

      // Update call log
      await getCallLogRef(actualCallSid).set({
        status: DialCallStatus,
        duration: CallDuration || 0,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Handle missed calls
      const MISSED_STATUSES = ["no-answer", "busy", "failed", "canceled"];
      
      if (MISSED_STATUSES.includes(DialCallStatus) && ownerUuid) {
        console.log(`[VOICE] Missed call - checking auto-reply for ${To}`);
        
        // Check if sender opted out
        const optedOut = await isOptedOut(From);
        if (optedOut) {
          console.log(`[VOICE] Skipping auto-reply - ${From} opted out`);
          return res.sendStatus(200);
        }

        // Get auto-reply settings
        const settings = await getAutoReplyByPhoneNumber({ phoneNumber: To });
        
        if (settings?.enabled && settings.missedCallMessage) {
          const messageBody = settings.missedCallMessage;
          
          try {
            console.log(`[VOICE AUTO-REPLY] Sending to ${From}: "${messageBody}"`);
            
            const smsResult = await sendSMS(From, messageBody, To);
            
            console.log(`[VOICE AUTO-REPLY] Sent: ${smsResult.sid}`);
          } catch (smsErr) {
            console.error(`[VOICE AUTO-REPLY] Failed to send SMS:`, smsErr);
            // Don't fail the webhook
          }
        } else {
          console.log(`[VOICE] Auto-reply disabled or no message configured`);
        }
      }

      return res.sendStatus(200);

    } catch (err) {
      console.error("[VOICE STATUS ERROR]:", err);
      // Always return 200 to prevent Twilio retries
      return res.sendStatus(200);
    }
  }
);

/* ================= INBOUND SMS ================= */

router.post(
  "/sms-inbound",
  rateLimit,
  twilioValidator,
  async (req, res) => {
    const { MessageSid, From, To, Body, NumMedia, OptOutType } = req.body;
    
    // Validate required fields
    if (!MessageSid || !From || !To) {
      console.warn('[SMS INBOUND] Missing required fields');
      return res.sendStatus(400);
    }

    if (!isValidE164(From) || !isValidE164(To)) {
      console.warn('[SMS INBOUND] Invalid phone format:', { From, To });
      return res.sendStatus(400);
    }

    try {
      // Atomic deduplication check
      if (await checkAndMarkWebhook(MessageSid, "inbound", req.body)) {
        console.log(`[SMS INBOUND] Duplicate webhook: ${MessageSid}`);
        return res
          .type("text/xml")
          .send(new twilio.twiml.MessagingResponse().toString());
      }

      // Handle opt-out/opt-in
      if (OptOutType) {
        const optedOut = await handleOptOut(From, OptOutType, Body);

        if (optedOut) {
          // Don't process STOP messages as regular messages
          return res
            .type("text/xml")
            .send(new twilio.twiml.MessagingResponse().toString());
        }
      }

      // Get recipient UUID (with caching)
      const cacheKey = `uuid:${To}`;
      let toUuid = cacheGet(cacheKey);
      
      if (!toUuid) {
        toUuid = await chatService.getUuidByPhone(To);
        if (toUuid) {
          cacheSet(cacheKey, toUuid);
        }
      }

      if (!toUuid) {
        console.warn(`[SMS INBOUND] No user mapping for ${To}`);
        return res.sendStatus(200);
      }

      // Extract media if MMS
      const mediaUrls = extractMediaUrls(req.body);
      const hasMedia = mediaUrls.length > 0;

      // Sanitize body
      const sanitizedBody = sanitizeBody(Body);

      // Skip FCM if this message was already sent from our outbound handler
      if (sentMessageSids.has(MessageSid)) {
        console.log(`[SMS INBOUND] Skipping FCM - already sent from outbound handler: ${MessageSid}`);
      } else {
        // Send push with message data so frontend can update UI immediately
        chatService.triggerSignal(toUuid, "NEW_MESSAGE", From, From, sanitizedBody, MessageSid)
          .catch(err => console.error('[SMS] Push failed:', err));
      }

      console.log(
        `[SMS INBOUND] ${MessageSid} -> ${toUuid}${
          hasMedia ? ` (${mediaUrls.length} media)` : ""
        }`
      );

      return res
        .type("text/xml")
        .send(new twilio.twiml.MessagingResponse().toString());
        
    } catch (err) {
      console.error("[SMS INBOUND ERROR]:", err);
      
      // Return 200 to prevent retry storm
      return res.sendStatus(200);
    }
  }
);

/* ================= STATUS CALLBACK ================= */

router.post(
  "/sms-status",
  rateLimit,
  twilioValidator,
  async (req, res) => {
    const { MessageSid, MessageStatus, From, To, ErrorCode, ErrorMessage } = req.body;

    if (!MessageSid || !MessageStatus) {
      console.warn('[SMS STATUS] Missing required fields');
      return res.sendStatus(400);
    }

    try {
      // Unique key includes status to track state transitions
      const webhookKey = `${MessageSid}_${MessageStatus}`;

      if (await checkAndMarkWebhook(webhookKey, "status", req.body)) {
        console.log(`[SMS STATUS] Duplicate webhook: ${webhookKey}`);
        return res.sendStatus(200);
      }

      const mappedStatus = mapTwilioStatus(MessageStatus);

      // Get sender UUID (with caching)
      const cacheKey = `uuid:${From}`;
      let fromUuid = cacheGet(cacheKey);
      
      if (!fromUuid) {
        fromUuid = await chatService.getUuidByPhone(From);
        if (fromUuid) {
          cacheSet(cacheKey, fromUuid);
        }
      }

      // Trigger status update signal
      if (fromUuid) {
        chatService.triggerSignal(
          fromUuid,
          "MESSAGE_STATUS_UPDATE",
          To,
          From
        ).catch(err => console.error('[SMS] Signal failed:', err));
      } else {
        console.warn(`[SMS STATUS] No UUID found for sender ${From}`);
      }

      console.log(
        `[SMS STATUS] ${MessageSid} -> ${mappedStatus}${
          ErrorCode ? ` (Error: ${ErrorCode})` : ""
        }`
      );

      return res.sendStatus(200);
      
    } catch (err) {
      console.error("[SMS STATUS ERROR]:", err);
      return res.sendStatus(200);
    }
  }
);

/* ================= HEALTH CHECK ================= */

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "twilio-webhooks",
  });
});

/* ================= CLEANUP ================= */

// Cleanup rate limiter every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export default router;