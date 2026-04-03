import { defaultDB, defaultMessaging } from "../server/db.js";
import { FCM_TOKENS_COLLECTION } from "../constants/index.js";

/**
 * Send FCM push notification to a specific user
 */
export const sendPushToUser = async (uuid, data) => {
  if (!uuid || !data) return null;

  try {
    const doc = await defaultDB
      .collection(FCM_TOKENS_COLLECTION)
      .doc(uuid)
      .get();

    if (!doc.exists) {
      console.warn(`[Push] No FCM token for user: ${uuid}`);
      return null;
    }

    const { token, platform = "android" } = doc.data();

    if (!token) return null;

    const message = {
      token,
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: "high",
      },
    };

    if (platform === "ios") {
      message.apns = {
        payload: {
          aps: {
            "content-available": 1,
            badge: 1,
          },
        },
      };
    }

    const response = await defaultMessaging.send(message);
    console.log(`[Push] Sent to ${uuid}:`, response);
    return response;
  } catch (err) {
    const errorCode = err.code || "";
    const errorMessage = err.message || "";
    
    // Check if token is invalid or not registered
    const isInvalidToken = 
      errorCode === "messaging/registration-token-not-registered" || 
      errorCode === "messaging/invalid-registration-token" ||
      errorMessage.includes("Requested entity was not found");

    if (isInvalidToken) {
      console.warn(`[Push] Invalid/Expired token for user ${uuid}. Removing from DB...`);
      try {
        await defaultDB.collection(FCM_TOKENS_COLLECTION).doc(uuid).delete();
      } catch (dbErr) {
        console.error(`[Push] Failed to delete stale token for ${uuid}:`, dbErr.message);
      }
    }

    console.error(`[Push] Failed to send to ${uuid}:`, errorMessage);
    return null;
  }
};