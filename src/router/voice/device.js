import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";
import { VOICE_BINDINGS_COLLECTION } from "../../constants/index.js";
import { getTwilioClient, callAmdState } from "./shared.js";

const router = Router();

router.post("/bind", verifyToken, async (req, res) => {
  const { phoneNumber } = req.body;
  const { email, uuid } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    await defaultDB
      .collection(VOICE_BINDINGS_COLLECTION)
      .doc(phoneNumber)
      .set({ phoneNumber, identity: uuid.replace(/-/g, "_"), uuid, updatedAt: new Date().toISOString() });

    return res.json({ success: true });
  } catch (err) {
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
