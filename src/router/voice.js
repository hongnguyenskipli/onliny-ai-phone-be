import { Router } from "express";
import twilio from "twilio";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";
import { VOICE_BINDINGS_COLLECTION } from "../constants/index.js";

const VoiceRouter = Router();

VoiceRouter.get("/token", verifyToken, (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_APP_SID, TWILIO_PUSH_CREDENTIAL_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_APP_SID) {
    return res.status(500).json({ message: "Twilio credentials not configured." });
  }

  const identity = req.user.email;

  const token = new twilio.jwt.AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
    { identity }
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

VoiceRouter.post("/bind", verifyToken, async (req, res) => {
  const { phoneNumber } = req.body;
  const identity = req.user.email;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    await defaultDB
      .collection(VOICE_BINDINGS_COLLECTION)
      .doc(phoneNumber)
      .set({ phoneNumber, identity, updatedAt: new Date().toISOString() });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to bind device." });
  }
});

VoiceRouter.post("/incoming", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;

  try {
    let identity = null;

    if (to) {
      const doc = await defaultDB
        .collection(VOICE_BINDINGS_COLLECTION)
        .doc(to)
        .get();

      if (doc.exists) {
        identity = doc.data().identity;
      }
    }

    if (!identity) {
      identity = process.env.TWILIO_CLIENT_IDENTITY;
    }

    if (identity) {
      const dial = twiml.dial();
      dial.client(identity);
    } else {
      twiml.say("No client registered to receive calls on this number.");
    }
  } catch (err) {
    twiml.say("An error occurred routing your call.");
  }

  return res.type("text/xml").send(twiml.toString());
});

VoiceRouter.post("/outgoing", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;

  if (to) {
    const dial = twiml.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
    if (to.startsWith("client:")) {
      dial.client(to.replace("client:", ""));
    } else {
      dial.number(to);
    }
  } else {
    twiml.say("No destination provided.");
  }

  return res.type("text/xml").send(twiml.toString());
});

export default VoiceRouter;
