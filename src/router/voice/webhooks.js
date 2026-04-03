import { Router } from "express";
import twilio from "twilio";

const router = Router();

/**
 * Default TwiML Voice Handler
 * Rejects all incoming and outgoing call requests as features are deleted.
 */
router.post("/handler", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.reject();
  return res.type("text/xml").send(twiml.toString());
});

// All other webhooks (dial-action, recording-status, etc.) are deleted.

export default router;
