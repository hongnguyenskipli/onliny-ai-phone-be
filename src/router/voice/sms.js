import { Router } from "express";
import crypto from "crypto";
import { sendSMS, isValidE164, getUserPhoneNumber } from "./shared.js";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { verifyToken } from "../../middleware/verifyToken.js";

const router = Router();

// In-memory idempotency cache
const requestCache = new Map();
const CACHE_TTL = 60000; // 1 minute

const generateIdempotencyKey = (uuid, to, body) => {
  return crypto
    .createHash('sha256')
    .update(`${uuid}-${to}-${body}-${Date.now()}`)
    .digest('hex')
    .substring(0, 16);
};

router.post("/send", verifyToken, async (req, res) => {
  const { to, body, from, tempId: clientTempId, idempotencyKey } = req.body;
  const { uuid } = req.user;

  if (!to || !body || !isValidE164(to)) {
    return res.status(400).json({ message: "Invalid recipient number" });
  }

  if (typeof body !== "string" || body.length > 1600) {
    return res.status(400).json({ message: "Invalid message body" });
  }

  try {
    let fromNumber = from || (await getUserPhoneNumber(uuid));

    if (!isValidE164(fromNumber)) {
      return res.status(400).json({ message: "Invalid sender number" });
    }

    if (fromNumber === to) {
      return res.status(400).json({ message: "Self-sending not allowed" });
    }

    // Idempotency check
    const idempKey = idempotencyKey || generateIdempotencyKey(uuid, to, body);
    const cached = requestCache.get(idempKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cached.result, cached: true });
    }

    const tempId = clientTempId || `${uuid}_${Date.now()}`;

    // 1. Save sending state
    await chatService.saveMessage({
      tempId,
      from: fromNumber,
      to,
      body,
      status: "sending",
      direction: "outgoing",
      fromUuid: uuid,
      conversationId: to,
      participants: [uuid, to],
    });

    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? "https" : "http");
    const statusCallback = `${protocol}://${req.get("host")}/api/voice/webhooks/sms-status`;

    let message;
    try {
      // 2. Send SMS
      message = await sendSMS(to, body, fromNumber, statusCallback);
    } catch (err) {
      await chatService.saveMessage({
        tempId,
        status: "failed",
        fromUuid: uuid,
      });
      throw err;
    }

    // 3. Update sent state with SID
    const savedMsg = await chatService.saveMessage({
      tempId,
      twilioSid: message.sid,
      status: "sent",
      fromUuid: uuid,
    });

    // Cache result
    requestCache.set(idempKey, { result: savedMsg, timestamp: Date.now() });
    setTimeout(() => requestCache.delete(idempKey), CACHE_TTL);

    // 4. Trigger FCM signal to SENDER (for status update)
    await chatService.triggerSignal(uuid, "MESSAGE_STATUS_UPDATE", to, fromNumber);

    // 5. Trigger FCM signal to RECIPIENT (if they are a user)
    const recipientUuid = await chatService.getUuidByPhone(to);
    if (recipientUuid) {
      await chatService.triggerSignal(recipientUuid, "NEW_MESSAGE", fromNumber, fromNumber);
    }

    console.log(`[SMS OUTBOUND] Sent SID: ${message.sid}`);

    return res.json({
      success: true,
      data: savedMsg,
    });

  } catch (err) {
    console.error("[SMS OUTBOUND ERROR]:", err.message);
    return res.status(500).json({ message: "Failed to send SMS." });
  }
});

router.get("/history", verifyToken, async (req, res) => {
  const { contactNumber, since, limit = 50 } = req.query;
  const { uuid } = req.user;

  if (!contactNumber || !isValidE164(contactNumber)) {
    return res.status(400).json({ message: "Invalid contactNumber" });
  }

  try {
    const messages = await chatService.getHistory(
      uuid,
      contactNumber,
      since,
      Math.min(parseInt(limit) || 50, 100)
    );

    return res.json({
      success: true,
      messages: messages.filter(msg => !msg.id.startsWith('temp_') || msg.status === 'sending'),
    });

  } catch (err) {
    console.error("[SMS HISTORY ERROR]:", err.message);
    return res.status(500).json({ message: "Failed to fetch history." });
  }
});

export default router;
