import { Router } from "express";
import twilio from "twilio";
import { verifyToken } from "../../middleware/verifyToken.js";

const router = Router();

router.get("/", verifyToken, (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_APP_SID, TWILIO_PUSH_CREDENTIAL_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_APP_SID) {
    return res.status(500).json({ message: "Twilio credentials not configured." });
  }

  const identity = req.user.uuid.replace(/-/g, "_");
  const token = new twilio.jwt.AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
    { identity, ttl: 86400 }
  );

  const voiceGrantOptions = {
    outgoingApplicationSid: TWILIO_APP_SID,
    incomingAllow: true,
  };

  if (TWILIO_PUSH_CREDENTIAL_SID) {
    voiceGrantOptions.pushCredentialSid = TWILIO_PUSH_CREDENTIAL_SID;
  }

  const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant(voiceGrantOptions);
  token.addGrant(voiceGrant);

  return res.json({ token: token.toJwt(), identity });
});

export default router;
