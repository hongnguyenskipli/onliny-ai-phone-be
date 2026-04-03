import { Router } from "express";
import { chatService } from "../../lib/Services/Chat/chatService.js";
import { isValidE164 } from "./shared.js";
import twilio from "twilio";

const router = Router();

/* ================= STATUS MAP ================= */

const mapTwilioStatus = (status) => {
  switch (status) {
    case "queued":
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
    case "failed":
      return "failed";
    default:
      return "sending";
  }
};

/* ================= VOICE HANDLER ================= */

router.post("/handler", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.reject();
  return res.type("text/xml").send(twiml.toString());
});

/* ================= INBOUND SMS ================= */

router.post(
  "/sms-inbound",
  twilio.webhook({ validate: true }),
  async (req, res) => {
    const { MessageSid, From, To, Body } = req.body;

    if (!MessageSid || !From || !To) {
      return res.sendStatus(400);
    }

    if (!isValidE164(From) || !isValidE164(To)) {
      return res.sendStatus(400);
    }

    try {
      const toUuid = await chatService.getUuidByPhone(To);

      if (!toUuid) {
        console.warn(`[SMS INBOUND] No mapping for ${To}`);
        return res.sendStatus(200);
      }

      await chatService.saveMessage({
        twilioSid: MessageSid,
        from: From,
        to: To,
        body: typeof Body === "string" ? Body : "",
        status: "delivered",
        direction: "incoming",
        toUuid,
        conversationId: From,
        participants: [toUuid, From],
      });

      await chatService.triggerSignal(
        toUuid,
        "NEW_MESSAGE",
        From,
        From
      );

      console.log(`[SMS INBOUND] ${MessageSid} -> ${toUuid}`);

      return res
        .type("text/xml")
        .send(new twilio.twiml.MessagingResponse().toString());

    } catch (err) {
      console.error("[SMS INBOUND ERROR]:", err.message);
      return res.sendStatus(500);
    }
  }
);

/* ================= STATUS CALLBACK ================= */

router.post(
  "/sms-status",
  twilio.webhook({ validate: true }),
  async (req, res) => {
    const { MessageSid, MessageStatus, From, To } = req.body;

    if (!MessageSid || !MessageStatus) {
      return res.sendStatus(400);
    }

    const mappedStatus = mapTwilioStatus(MessageStatus);

    try {
      const fromUuid = await chatService.getUuidByPhone(From);

      const updated = await chatService.saveMessage({
        twilioSid: MessageSid,
        status: mappedStatus,
        fromUuid: fromUuid || null,
      });

      const targetUuid = updated?.fromUuid || fromUuid;

      if (targetUuid) {
        await chatService.triggerSignal(
          targetUuid,
          "MESSAGE_STATUS_UPDATE",
          To,
          From
        );
      }

      console.log(`[SMS STATUS] ${MessageSid} -> ${mappedStatus}`);

      return res.sendStatus(200);

    } catch (err) {
      console.error("[SMS STATUS ERROR]:", err.message);
      return res.sendStatus(500);
    }
  }
);

export default router;
