import { Router } from "express";
import crypto from "crypto";
import { sendSMS, isValidE164, getUserPhoneNumber, getTwilioClient } from "./shared.js";
import { verifyToken } from "../../middleware/verifyToken.js";

const router = Router();

const requestCache = new Map();
const CACHE_TTL = 60000;

const generateIdempotencyKey = (uuid, to, body) => {
  return crypto
    .createHash('sha256')
    .update(`${uuid}-${to}-${body}-${Date.now()}`)
    .digest('hex')
    .substring(0, 16);
};

const normalizeTwilioMessage = (msg) => {
  return {
    id: msg.sid,
    twilioSid: msg.sid,
    type: 'sms',
    body: msg.body || '',
    from: msg.from,
    to: msg.to,
    direction: msg.direction === 'outbound-api' ? 'outgoing' : 'incoming',
    status: msg.status === 'queued' || msg.status === 'sending' ? 'sent' : msg.status,
    startTime: msg.dateCreated ? new Date(msg.dateCreated).toISOString() : new Date().toISOString(),
    createdAt: msg.dateCreated ? new Date(msg.dateCreated).toISOString() : new Date().toISOString(),
    updatedAt: msg.dateUpdated ? new Date(msg.dateUpdated).toISOString() : new Date().toISOString(),
    isAutoReply: false,
  };
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

    const idempKey = idempotencyKey || generateIdempotencyKey(uuid, to, body);
    const cached = requestCache.get(idempKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cached.result, cached: true });
    }

    const tempId = clientTempId || `${uuid}_${Date.now()}`;

    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? "https" : "http");
    const statusCallback = `${protocol}://${req.get("host")}/api/voice/webhooks/sms-status`;

    let message;
    try {
      message = await sendSMS(to, body, fromNumber, statusCallback);
    } catch (err) {
      throw err;
    }

    const normalizedMsg = normalizeTwilioMessage(message);
    normalizedMsg.tempId = tempId;

    requestCache.set(idempKey, { result: normalizedMsg, timestamp: Date.now() });
    setTimeout(() => requestCache.delete(idempKey), CACHE_TTL);

    console.log(`[SMS OUTBOUND] Sent SID: ${message.sid}`);

    return res.json({
      success: true,
      data: normalizedMsg,
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
    const client = getTwilioClient();
    const userPhone = await getUserPhoneNumber(uuid);

    if (!userPhone) {
      return res.status(400).json({ message: "No phone number found for user" });
    }

    const limitNum = Math.min(parseInt(limit) || 50, 100);

    const [outbound, inbound] = await Promise.all([
      client.messages.list({ from: userPhone, to: contactNumber, limit: limitNum }).catch(() => []),
      client.messages.list({ from: contactNumber, to: userPhone, limit: limitNum }).catch(() => []),
    ]);

    const allMessages = [...outbound, ...inbound]
      .sort((a, b) => (a.dateSent || a.dateCreated) - (b.dateSent || b.dateCreated))
      .map(normalizeTwilioMessage);

    return res.json({
      success: true,
      messages: allMessages,
    });

  } catch (err) {
    console.error("[SMS HISTORY ERROR]:", err.message);
    return res.status(500).json({ message: "Failed to fetch history." });
  }
});

export default router;
