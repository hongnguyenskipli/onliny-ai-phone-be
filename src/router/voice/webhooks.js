import { Router } from "express";
import twilio from "twilio";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION, USER_NUMBERS_COLLECTION } from "../../constants/index.js";
import { getCallerIdByIdentity, callAmdState } from "./shared.js";

const router = Router();

router.post("/incoming", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;

  try {
    let identity = null;

    if (to) {
      const doc = await defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(to).get();
      if (doc.exists) {
        identity = doc.data().identity;
      } else {
        console.log(`[INCOMING WEBHOOK] No DB record for ${to}`);
      }
    }

    if (!identity) {
      identity = process.env.TWILIO_CLIENT_IDENTITY;
    }

    if (identity) {
     const dial = twiml.dial({
        record: "record-from-answer-dual",
        recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
      });
      dial.client(identity);
    } else {
      twiml.say("No client registered to receive calls on this number.");
    }
  } catch (err) {
    twiml.say("An error occurred routing your call.");
  }

  return res.type("text/xml").send(twiml.toString());
});

router.post("/outgoing", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;
  const callerRaw = req.body.Caller || "";
  const identity = callerRaw.startsWith("client:") ? callerRaw.slice(7) : null;
  const baseUrl = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const parentCallSid = req.body.CallSid;

  let callerId = process.env.TWILIO_PHONE_NUMBER;
  if (identity) {
    callerId = await getCallerIdByIdentity(identity);
  }

  if (to) {
    const dialOptions = {
      callerId,
      record: "do-not-record",
    };

    if (!to.startsWith("client:")) {
      dialOptions.record = "record-from-answer-dual";
      dialOptions.recordingStatusCallback = `${baseUrl}/api/voice/recording-status`;
      dialOptions.recordingStatusCallbackMethod = "POST";

      if (parentCallSid) {
        callAmdState.set(parentCallSid, {
          childCallSid: null,
          humanConnected: false,
          timestamp: Date.now(),
        });
      }
    }

    const dial = twiml.dial(dialOptions);
    if (to.startsWith("client:")) {
      dial.client(to.replace("client:", ""));
    } else {
      dial.number(
        {
          statusCallbackEvent: "answered",
          statusCallback: `${baseUrl}/api/voice/call-answered?parentSid=${parentCallSid}`,
          statusCallbackMethod: "POST",
        },
        to
      );
    }
  } else {
    twiml.say("No destination provided.");
  }

  return res.type("text/xml").send(twiml.toString());
});

router.post("/recording-status", (req, res) => {
  res.sendStatus(204);
});

router.post("/call-answered", async (req, res) => {
  const { CallStatus, CallSid } = req.body;
  const parentSid = req.query.parentSid;

  res.sendStatus(204);

  if (CallStatus !== "in-progress" || !parentSid) return;

  const existing = callAmdState.get(parentSid) || {};
  callAmdState.set(parentSid, {
    ...existing,
    childCallSid: CallSid,
    humanConnected: true,
    timestamp: existing.timestamp || Date.now(),
  });
});

router.post("/amd-status", (req, res) => {
  res.sendStatus(204);
});

export default router;
