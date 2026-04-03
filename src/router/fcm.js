import { Router } from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";
import { FCM_TOKENS_COLLECTION } from "../constants/index.js";

const router = Router();

/**
 * @api {post} /api/fcm/register Register/Update FCM Token
 * Standardized registration for mobile devices
 */
router.post("/register", verifyToken, async (req, res) => {
  const { 
    fcmToken, 
    token: altToken, 
    platform = "android", 
    deviceModel = "unknown",
    appVersion = "1.0.0"
  } = req.body;
  
  const { uuid } = req.user;
  const token = fcmToken || altToken;

  if (!token) {
    return res.status(400).json({ message: "FCM token is required." });
  }

  try {
    console.log(`[FCM-STD] Registering ${platform} token for user ${uuid}`);

    const tokenData = {
      token,
      uuid,
      platform: platform.toLowerCase(),
      deviceModel,
      appVersion,
      updatedAt: new Date().toISOString(),
    };

    await defaultDB
      .collection(FCM_TOKENS_COLLECTION)
      .doc(uuid)
      .set(tokenData, { merge: true });

    console.log(`[FCM-STD] Successfully registered token for ${uuid}`);
    
    return res.json({ 
      success: true, 
      message: "FCM token registered successfully.",
      data: {
        uuid,
        platform: tokenData.platform,
        updatedAt: tokenData.updatedAt
      }
    });

  } catch (err) {
    console.error(`[FCM-STD] Registration failed for ${uuid}:`, err.message);
    return res.status(500).json({ message: "Failed to register FCM token" });
  }
});

/**
 * @api {post} /api/fcm/unregister Unregister FCM Token
 */
router.post("/unregister", verifyToken, async (req, res) => {
  const { uuid } = req.user;

  try {
    await defaultDB.collection(FCM_TOKENS_COLLECTION).doc(uuid).delete();
    console.log(`[FCM-STD] Unregistered token for user ${uuid}`);
    return res.json({ success: true, message: "Token unregistered." });
  } catch (err) {
    console.error(`[FCM-STD] Unregister failed for ${uuid}:`, err.message);
    return res.status(500).json({ message: "Failed to unregister token" });
  }
});

export default router;
