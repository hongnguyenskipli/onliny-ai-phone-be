import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { sendSMS } from "./shared.js";

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
    const message = await sendSMS(to, body, from);
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
  const { From, Body, To } = req.body;
  console.log(`[SMS INCOMING] From: ${From}, To: ${To}, Body: ${Body}`);
  return res.status(204).send();
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
