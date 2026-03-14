import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";
import { CALL_FORWARDING_COLLECTION } from "../../constants/index.js";

const router = Router();

router.get("/forwarding", verifyToken, async (req, res) => {
  const { uuid } = req.user;
  try {
    const doc = await defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).get();
    const defaults = {
      enabled: false,
      forwardingNumber: "",
      forwardOnBusy: true,
      forwardOnNoAnswer: true,
      forwardOnUnreachable: false,
    };
    return res.json({ success: true, data: doc.exists ? doc.data() : defaults });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch forwarding settings." });
  }
});

router.put("/forwarding", verifyToken, async (req, res) => {
  const { uuid, email } = req.user;
  const { enabled, forwardingNumber, forwardOnBusy, forwardOnNoAnswer, forwardOnUnreachable } = req.body;

  try {
    const data = {
      uuid,
      userEmail: email,
      enabled,
      forwardingNumber,
      forwardOnBusy,
      forwardOnNoAnswer,
      forwardOnUnreachable,
      updatedAt: new Date().toISOString(),
    };
    await defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).set(data);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update forwarding settings." });
  }
});

export default router;
