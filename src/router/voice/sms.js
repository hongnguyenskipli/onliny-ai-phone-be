import { Router } from "express";
import { sendSMS, isValidE164, getUserPhoneNumber } from "./shared.js";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { verifyToken } from "../../middleware/auth.js";

const router = Router();

const MISSED_CALL_SMS_TEMPLATES = {
  default:
    "Xin chào! Ban da co cuoc goi nho tu {caller_number}. Vui long goi lai neu can thiet. Cam on!",
};

export const getMissedCallMessage = (callerNumber, customTemplate) => {
  const template = customTemplate || MISSED_CALL_SMS_TEMPLATES.default;
  return template.replace(/{caller_number}/g, callerNumber);
};

router.post("/send", verifyToken, async (req, res) => {
  const { to, body, from, tempId: clientTempId } = req.body;
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

    const tempId = clientTempId || `tmp-${Date.now()}`;

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

    const protocol = req.secure ? "https" : "http";
    const statusCallback = `${protocol}://${req.get("host")}/api/voice/webhooks/sms-status`;

    let message;

    try {
      // 2. Send SMS
      message = await sendSMS(to, body, fromNumber, statusCallback);
    } catch (err) {
      // 2.1 Mark failed if Twilio error
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

    // 4. Trigger FCM signal
    await chatService.triggerSignal(
      uuid,
      "MESSAGE_STATUS_UPDATE",
      to,
      fromNumber
    );

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
  const { contactNumber, since, cursor } = req.query;
  const { uuid } = req.user;

  if (!contactNumber || !isValidE164(contactNumber)) {
    return res.status(400).json({ message: "Invalid contactNumber" });
  }

  try {
    const messages = await chatService.getHistory(
      uuid,
      contactNumber,
      since,
      cursor
    );

    return res.json({
      success: true,
      messages,
    });

  } catch (err) {
    console.error("[SMS HISTORY ERROR]:", err.message);
    return res.status(500).json({ message: "Failed to fetch history." });
  }
});

export default router;
