import { Router } from "express";
import { sendSMS, isValidE164, getUserPhoneNumber } from "./shared.js";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { verifyToken } from "../../middleware/auth.js";
import crypto from "crypto";

const router = Router();

// In-memory idempotency cache (production nên dùng Redis)
const requestCache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Generate unique idempotency key
 */
const generateIdempotencyKey = (uuid, to, body) => {
  return crypto
    .createHash('sha256')
    .update(`${uuid}-${to}-${body}-${Date.now()}`)
    .digest('hex')
    .substring(0, 16);
};

/**
 * Check if request is duplicate
 */
const isDuplicateRequest = (idempotencyKey) => {
  const cached = requestCache.get(idempotencyKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  
  return null;
};

/**
 * Cache request result
 */
const cacheRequest = (idempotencyKey, result) => {
  requestCache.set(idempotencyKey, {
    result,
    timestamp: Date.now(),
  });
  
  // Auto cleanup
  setTimeout(() => {
    requestCache.delete(idempotencyKey);
  }, CACHE_TTL);
};

/**
 * Verify user owns the phone number
 */
const verifyPhoneOwnership = async (uuid, phoneNumber) => {
  const userPhone = await getUserPhoneNumber(uuid);
  return userPhone === phoneNumber;
};

/**
 * Get correct protocol (handle proxy/load balancer)
 */
const getProtocol = (req) => {
  return req.headers['x-forwarded-proto'] || 
         (req.secure ? 'https' : 'http');
};

/**
 * Notify recipient about new message
 */
const notifyRecipient = async (recipientNumber, fromNumber, body) => {
  try {
    const recipientUuid = await chatService.getUuidByPhone(recipientNumber);
    
    if (recipientUuid) {
      await chatService.triggerSignal(
        recipientUuid,
        "NEW_MESSAGE",
        fromNumber, // conversationId
        fromNumber
      );
      
      console.log(`[SMS] Notified recipient: ${recipientNumber}`);
    }
  } catch (err) {
    console.warn('[SMS] Failed to notify recipient:', err.message);
    // Don't throw - notification failure shouldn't break send
  }
};

router.post("/send", verifyToken, async (req, res) => {
  const { to, body, from, tempId: clientTempId, idempotencyKey } = req.body;
  const { uuid } = req.user;

  // 1. Validate input
  if (!to || !body || !isValidE164(to)) {
    return res.status(400).json({ message: "Invalid recipient number" });
  }

  if (typeof body !== "string" || body.length > 1600) {
    return res.status(400).json({ message: "Invalid message body" });
  }

  try {
    // 2. Get sender number
    let fromNumber = from || (await getUserPhoneNumber(uuid));

    if (!isValidE164(fromNumber)) {
      return res.status(400).json({ message: "Invalid sender number" });
    }

    // 3. Verify ownership if custom from number
    if (from && from !== fromNumber) {
      const hasOwnership = await verifyPhoneOwnership(uuid, from);
      if (!hasOwnership) {
        return res.status(403).json({ message: "Not authorized to use this number" });
      }
      fromNumber = from;
    }

    // 4. Prevent self-sending
    if (fromNumber === to) {
      return res.status(400).json({ message: "Self-sending not allowed" });
    }

    // 5. Idempotency check
    const idempKey = idempotencyKey || generateIdempotencyKey(uuid, to, body);
    const cachedResult = isDuplicateRequest(idempKey);
    
    if (cachedResult) {
      console.log(`[SMS] Duplicate request blocked: ${idempKey}`);
      return res.json({
        success: true,
        data: cachedResult,
        cached: true,
      });
    }

    // 6. Generate unique tempId
    const tempId = clientTempId || `${uuid}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 7. Initial save with sending state (temp doc only)
    const initialMsg = await chatService.saveMessage({
      tempId,
      from: fromNumber,
      to,
      body,
      status: "sending",
      direction: "outgoing",
      fromUuid: uuid,
      conversationId: to,
      participants: [uuid, to],
      idempotencyKey: idempKey,
    });

    const protocol = getProtocol(req);
    const statusCallback = `${protocol}://${req.get("host")}/api/voice/webhooks/sms-status`;

    let message;

    try {
      // 8. Send SMS via Twilio
      message = await sendSMS(to, body, fromNumber, statusCallback);
      
      console.log(`[SMS OUTBOUND] Sent SID: ${message.sid}`);

    } catch (twilioErr) {
      // 8.1 Mark as failed
      await chatService.saveMessage({
        tempId,
        status: "failed",
        errorMessage: twilioErr.message,
        errorCode: twilioErr.code,
      });

      console.error(`[SMS OUTBOUND ERROR]:`, twilioErr);

      return res.status(500).json({ 
        message: "Failed to send SMS",
        error: twilioErr.message,
      });
    }

    // 9. ✅ FIX: Migrate temp → permanent với twilioSid
    // Đây là điểm quan trọng để tránh duplicate!
    const savedMsg = await chatService.saveMessage({
      tempId,           // ← Để chatService migrate
      twilioSid: message.sid,
      status: "sent",
      sentAt: new Date().toISOString(),
    });

    // 10. Cache result for idempotency
    cacheRequest(idempKey, savedMsg);

    // 11. Notify sender về status update
    await chatService.triggerSignal(
      uuid,
      "MESSAGE_STATUS_UPDATE",
      to,
      fromNumber
    );

    // 12. ✅ FIX: Notify recipient về new message
    await notifyRecipient(to, fromNumber, body);

    return res.json({
      success: true,
      data: {
        ...savedMsg,
        twilioSid: message.sid,
      },
    });

  } catch (err) {
    console.error("[SMS OUTBOUND ERROR]:", err);
    return res.status(500).json({ 
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

router.get("/history", verifyToken, async (req, res) => {
  const { contactNumber, since, limit = 50 } = req.query;
  const { uuid } = req.user;

  // 1. Validate
  if (!contactNumber || !isValidE164(contactNumber)) {
    return res.status(400).json({ message: "Invalid contactNumber" });
  }

  const messageLimit = Math.min(parseInt(limit) || 50, 100); // Max 100

  try {
    // 2. Get history
    const messages = await chatService.getHistory(
      uuid,
      contactNumber,
      since,
      messageLimit
    );

    // 3. Filter out temp messages (only show migrated ones)
    const cleanMessages = messages.filter(msg => 
      !msg.id.startsWith('temp_') || msg.status === 'sending'
    );

    return res.json({
      success: true,
      messages: cleanMessages,
      count: cleanMessages.length,
    });

  } catch (err) {
    console.error("[SMS HISTORY ERROR]:", err);
    return res.status(500).json({ 
      message: "Failed to fetch history",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// 🆕 Endpoint để retry failed messages
router.post("/retry/:messageId", verifyToken, async (req, res) => {
  const { messageId } = req.params;
  const { uuid } = req.user;

  try {
    // Get failed message
    const msgDoc = await defaultDB.collection(MESSAGES_COLLECTION).doc(messageId).get();
    
    if (!msgDoc.exists) {
      return res.status(404).json({ message: "Message not found" });
    }

    const msgData = msgDoc.data();

    // Verify ownership
    if (msgData.fromUuid !== uuid) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Check if failed
    if (msgData.status !== 'failed') {
      return res.status(400).json({ message: "Only failed messages can be retried" });
    }

    // Retry by creating new send request
    return await router.handle({
      ...req,
      body: {
        to: msgData.to,
        body: msgData.body,
        from: msgData.from,
        originalMessageId: messageId,
      }
    }, res);

  } catch (err) {
    console.error("[SMS RETRY ERROR]:", err);
    return res.status(500).json({ message: "Failed to retry" });
  }
});

// Cleanup cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of requestCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
}, CACHE_TTL);

export default router;