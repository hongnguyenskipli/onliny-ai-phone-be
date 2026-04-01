import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { sendSMS, cacheDelete, cacheInvalidateByPrefix, getUserPhoneNumber } from "./shared.js";
import { sendPushToUser } from "../../lib/pushNotification.js";
import { emitToUser } from "../../lib/socketHandler.js";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION } from "../../constants/index.js";

const router = Router();

const MISSED_CALL_SMS_TEMPLATES = {
  default: "Xin chào! Ban da co cuoc goi nho tu {caller_number}. Vui long goi lai neu can thiet. Cam on!",
};

export const getMissedCallMessage = (callerNumber, customTemplate) => {
  const template = customTemplate || MISSED_CALL_SMS_TEMPLATES.default;
  return template.replace(/{caller_number}/g, callerNumber);
};

router.post("/send", verifyToken, async (req, res) => {
  const { to, body, from } = req.body;

  if (!to || !body) {
    return res.status(400).json({ message: "Missing required fields: to, body" });
  }

  try {
    const { uuid } = req.user;
    let fromNumber = from;
    if (!fromNumber) {
      fromNumber = await getUserPhoneNumber(uuid);
    }
    
    const message = await sendSMS(to, body, fromNumber);

    // Invalidate all related caches for this user
    cacheDelete(`sms-thread:${uuid}:${to}`);
    cacheInvalidateByPrefix(`calls:${uuid}`);
    cacheInvalidateByPrefix(`thread:${uuid}`);

    // Emit socket event immediately so frontend refreshes in real-time
    emitToUser(uuid, "new_message", {
      contactNumber: to,
      direction: "outgoing",
      body,
      sid: message.sid,
      source: "sms_sent",
    });

    return res.json({
      success: true,
      data: {
        sid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
      },
    });
  } catch (err) {
    console.error("[SMS] Failed to send:", err.message);
    return res.status(500).json({ message: "Failed to send SMS." });
  }
});

router.post("/incoming", async (req, res) => {
  const { From, Body, To, MessageSid } = req.body;
  console.log(`[SMS INCOMING] From: ${From}, To: ${To}, Body: ${Body}`);
  res.status(204).send();

  // Send push notification to the user who owns this number
  try {
    const doc = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(To).get();
    if (doc.exists) {
      const uuid = doc.data().uuid;
      
      cacheDelete(`sms-thread:${uuid}:${From}`);
      cacheInvalidateByPrefix(`calls:${uuid}`);
      cacheInvalidateByPrefix(`thread:${uuid}`);
      
      await sendPushToUser(uuid, {
        type: "sms_received",
        contactNumber: From,
      });

      emitToUser(uuid, "new_message", {
        contactNumber: From,
        direction: "incoming",
        body: Body,
        sid: MessageSid,
        source: "sms_received",
      });
    }
  } catch (err) {
    console.error("[SMS INCOMING] Push/Socket failed:", err.message);
  }
});

router.get("/:messageSid/status", verifyToken, async (req, res) => {
  const { messageSid } = req.params;

  try {
    const { getTwilioClient } = await import("./shared.js");
    const client = getTwilioClient();
    const message = await client.messages(messageSid).fetch();

    return res.json({
      success: true,
      data: {
        sid: message.sid,
        status: message.status,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch message status." });
  }
});

export default router;
