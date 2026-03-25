import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";

const router = Router();

router.post("/fcm-token", verifyToken, async (req, res) => {
  const { fcmToken } = req.body;
  const { uuid } = req.user;

  if (!fcmToken) {
    return res.status(400).json({ message: "Missing fcmToken" });
  }

  try {
    await defaultDB.collection("fcm_tokens").doc(uuid).set({
      token: fcmToken,
      uuid,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("[FCM] Failed to save token:", err.message);
    return res.status(500).json({ message: "Failed to save FCM token" });
  }
});

export default router;
