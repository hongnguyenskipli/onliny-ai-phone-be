import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION, FCM_TOKENS_COLLECTION } from "../../constants/index.js";
import { getTwilioClient, callAmdState } from "./shared.js";

const router = Router();

router.post("/bind", verifyToken, async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;
  const { email, uuid } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    const batch = defaultDB.batch();

    // 1. Save Voice Binding (Twilio Identity)
    const bindingRef = defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(phoneNumber);
    batch.set(bindingRef, {
      phoneNumber,
      identity: uuid.replace(/-/g, "_"),
      uuid,
      updatedAt: new Date().toISOString()
    });

    // 2. Save FCM Token if provided in the same request
    if (fcmToken) {
      console.log(`[FCM] Saving token via /bind for user ${uuid}`);
      const fcmRef = defaultDB.collection(FCM_TOKENS_COLLECTION).doc(uuid);
      batch.set(fcmRef, {
        token: fcmToken,
        uuid,
        updatedAt: new Date().toISOString()
      });
    }

    await batch.commit();
    console.log(`[Bind] Successfully bound ${phoneNumber} and processed FCM for user ${uuid}`);

    return res.json({ success: true, fcmSaved: !!fcmToken });
  } catch (err) {
    console.error(`[Bind] Failed for user ${uuid}:`, err.message);
    return res.status(500).json({ message: "Failed to bind device." });
  }
});

router.get("/calls/:callSid/amd-state", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  const state = callAmdState.get(callSid);
  if (state?.humanConnected) {
    return res.json({ success: true, data: state });
  }

  try {
    const client = getTwilioClient();
    const childCalls = await client.calls.list({ parentCallSid: callSid, limit: 1 });

    if (childCalls.length > 0 && childCalls[0].status === "in-progress") {
      const childCall = childCalls[0];
      const newState = {
        ...(state || {}),
        childCallSid: childCall.sid,
        humanConnected: true,
        timestamp: state?.timestamp || Date.now(),
      };
      callAmdState.set(callSid, newState);
      return res.json({ success: true, data: newState });
    }
  } catch (_) {
    // noop
  }

  return res.json({ success: true, data: state || null });
});

export default router;
