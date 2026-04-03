import { Router } from "express";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { isValidE164 } from "./shared.js";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { FieldValue } from "firebase-admin/firestore";

const router = Router();

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
 * Check if webhook already processed (idempotency)
 */
const isWebhookProcessed = async (webhookId, type) => {
  try {
    const docRef = defaultDB
      .collection("webhook_logs")
      .doc(`${type}_${webhookId}`);
    const doc = await docRef.get();
    return doc.exists;
  } catch (err) {
    console.warn('[WEBHOOK] Failed to check processed status:', err);
    return false; // Fail open - allow processing
  }
};

/**
 * Mark webhook as processed
 */
const markWebhookProcessed = async (webhookId, type, data) => {
  try {
    await defaultDB
      .collection("webhook_logs")
      .doc(`${type}_${webhookId}`)
      .set({
        webhookId,
        type,
        data,
        processedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days TTL
      });
  } catch (err) {
    console.warn('[WEBHOOK] Failed to mark as processed:', err);
    // Don't throw - logging failure shouldn't break flow
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
 * Check if user opted out
 */
const isOptedOut = async (phoneNumber) => {
  try {
    const doc = await defaultDB
      .collection("sms_opt_outs")
      .doc(phoneNumber)
      .get();
    return doc.exists;
  } catch (err) {
    console.warn('[SMS] Failed to check opt-out status:', err);
    return false;
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
      console.log(`[SMS] User opted out: ${phoneNumber}`);
      return true;
    }

    if (optOutType === "START") {
      await defaultDB.collection("sms_opt_outs").doc(phoneNumber).delete();
      console.log(`[SMS] User opted in: ${phoneNumber}`);
      return false;
    }

    return false;
  } catch (err) {
    console.error('[SMS] Failed to handle opt-out:', err);
    return false;
  }
};

/* ================= VOICE HANDLER ================= */

router.post(
  "/handler",
  twilio.webhook({ validate: process.env.NODE_ENV === 'production' }),
  async (req, res) => {
    const { From, To, CallSid } = req.body;

    console.log(`[VOICE] Rejected call ${CallSid} from ${From} to ${To}`);

    // Optional: Log rejected calls
    try {
      await defaultDB.collection("call_logs").add({
        callSid: CallSid,
        from: From,
        to: To,
        action: "rejected",
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[VOICE] Failed to log rejected call:', err);
    }

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.reject();

    return res.type("text/xml").send(twiml.toString());
  }
);

/* ================= INBOUND SMS ================= */

router.post(
  "/sms-inbound",
  twilio.webhook({ validate: process.env.NODE_ENV === 'production' }),
  async (req, res) => {
    const { MessageSid, From, To, Body, NumMedia, OptOutType } = req.body;

    if (!MessageSid || !From || !To) {
      console.warn('[SMS INBOUND] Missing required fields');
      return res.sendStatus(400);
    }

    if (!isValidE164(From) || !isValidE164(To)) {
      console.warn('[SMS INBOUND] Invalid phone format');
      return res.sendStatus(400);
    }

    try {
      // Idempotency check
      if (await isWebhookProcessed(MessageSid, "inbound")) {
        console.log(`[SMS INBOUND] Duplicate webhook: ${MessageSid}`);
        return res
          .type("text/xml")
          .send(new twilio.twiml.MessagingResponse().toString());
      }

      // Handle opt-out/opt-in
      if (OptOutType) {
        await handleOptOut(From, OptOutType, Body);

        if (OptOutType === "STOP") {
          // Don't process as regular message
          await markWebhookProcessed(MessageSid, "inbound", req.body);
          return res
            .type("text/xml")
            .send(new twilio.twiml.MessagingResponse().toString());
        }
      }

      // Get recipient UUID
      const toUuid = await chatService.getUuidByPhone(To);

      if (!toUuid) {
        console.warn(`[SMS INBOUND] No user mapping for ${To}`);
        await markWebhookProcessed(MessageSid, "inbound", req.body);
        return res.sendStatus(200);
      }

      // Extract media if MMS
      const mediaUrls = extractMediaUrls(req.body);
      const hasMedia = mediaUrls.length > 0;

      // Save message
      await chatService.saveMessage({
        twilioSid: MessageSid,
        from: From,
        to: To,
        body: typeof Body === "string" ? Body.substring(0, 1600) : "",
        mediaUrls: hasMedia ? mediaUrls : null,
        hasMedia,
        status: "delivered",
        direction: "incoming",
        toUuid,
        conversationId: From,
        participants: [toUuid, From],
      });

      // Trigger push notification
      await chatService.triggerSignal(toUuid, "NEW_MESSAGE", From, From);

      console.log(
        `[SMS INBOUND] ${MessageSid} -> ${toUuid}${
          hasMedia ? ` (${mediaUrls.length} media)` : ""
        }`
      );

      // Mark as processed
      await markWebhookProcessed(MessageSid, "inbound", req.body);

      return res
        .type("text/xml")
        .send(new twilio.twiml.MessagingResponse().toString());
    } catch (err) {
      console.error("[SMS INBOUND ERROR]:", err);
      
      // Still return 200 to prevent retry storm
      // Twilio will retry 5xx errors
      return res.sendStatus(200);
    }
  }
);

/* ================= STATUS CALLBACK ================= */

router.post(
  "/sms-status",
  twilio.webhook({ validate: process.env.NODE_ENV === 'production' }),
  async (req, res) => {
    const { MessageSid, MessageStatus, From, To, ErrorCode, ErrorMessage } =
      req.body;

    if (!MessageSid || !MessageStatus) {
      console.warn('[SMS STATUS] Missing required fields');
      return res.sendStatus(400);
    }

    const mappedStatus = mapTwilioStatus(MessageStatus);

    try {
      // Idempotency: unique key includes status to track transitions
      const webhookKey = `${MessageSid}_${MessageStatus}`;

      if (await isWebhookProcessed(webhookKey, "status")) {
        console.log(`[SMS STATUS] Duplicate webhook: ${webhookKey}`);
        return res.sendStatus(200);
      }

      // Get sender UUID
      const fromUuid = await chatService.getUuidByPhone(From);

      // Update message status
      const updated = await chatService.saveMessage({
        twilioSid: MessageSid,
        status: mappedStatus,
        fromUuid: fromUuid || null,
        ...(ErrorCode && {
          errorCode: ErrorCode,
          errorMessage: ErrorMessage,
        }),
        lastStatusUpdate: new Date().toISOString(),
      });

      // Trigger status update notification
      const targetUuid = updated?.fromUuid || fromUuid;

      if (targetUuid) {
        await chatService.triggerSignal(
          targetUuid,
          "MESSAGE_STATUS_UPDATE",
          To,
          From
        );
      } else {
        console.warn(`[SMS STATUS] No UUID found for sender ${From}`);
      }

      console.log(
        `[SMS STATUS] ${MessageSid} -> ${mappedStatus}${
          ErrorCode ? ` (Error: ${ErrorCode})` : ""
        }`
      );

      // Mark as processed
      await markWebhookProcessed(webhookKey, "status", req.body);

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
  });
});

export default router;