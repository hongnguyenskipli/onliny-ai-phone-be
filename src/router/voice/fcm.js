import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";
import { FCM_TOKENS_COLLECTION } from "../../constants/index.js";

const router = Router();

router.post("/fcm-token", verifyToken, async (req, res) => {
  const { fcmToken, platform = "android" } = req.body;
  const { uuid } = req.user;

  if (!fcmToken) {
    return res.status(400).json({ message: "Missing fcmToken" });
  }

  try {
    console.log(`[FCM] Receiving token for user ${uuid}: ${fcmToken.substring(0, 10)}...`);
    await defaultDB.collection(FCM_TOKENS_COLLECTION).doc(uuid).set({
      token: fcmToken,
      uuid,
      platform: platform.toLowerCase(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`[FCM] Successfully saved token for user ${uuid}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[FCM] Failed to save token:", err.message);
    return res.status(500).json({ message: "Failed to save FCM token" });
  }
});

export default router;
