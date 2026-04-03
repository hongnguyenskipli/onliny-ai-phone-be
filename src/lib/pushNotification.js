import { defaultDB, defaultMessaging } from "../server/db.js";
import { FCM_TOKENS_COLLECTION } from "../constants/index.js";

/**
 * Send FCM push notification to a specific user
 * @param {string} uuid - User UUID
 * @param {object} data - Notification data (keys must be strings) 
 */
export const sendPushToUser = async (uuid, data) => {
  if (!uuid || !data) {
    console.warn("[Push] Missing uuid or payload data");
    return null;
  }

  try {
    // 1. Fetch Registered Device Token
    const doc = await defaultDB
      .collection(FCM_TOKENS_COLLECTION)
      .doc(uuid)
      .get();

    if (!doc.exists) {
      console.warn(`[Push] No FCM token found for user: ${uuid}. Is the user registered?`);
      return null;
    }

    const deviceData = doc.data();
    const { token, platform = "android" } = deviceData;

    if (!token) {
      console.warn(`[Push] Token record exists but 'token' field is empty for ${uuid}`);
      return null;
    }

    // 2. Build FCM Message
    // IMPORTANT: All data keys and values must be strings for Firebase
    const message = {
      token,
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: "high",
      },
    };

    // 3. Platform Specific Overrides
    if (platform === "ios") {
      message.apns = {
        payload: {
          aps: {
            "content-available": 1,
            badge: 1,
            sound: "default"
          },
        },
      };
    }

    // 4. Send
    const response = await defaultMessaging.send(message);
    console.log(`[Push] Successfully sent to ${uuid} (Platform: ${platform})`);
    return response;

  } catch (err) {
    const errorCode = err.code || "";
    const errorMessage = err.message || "";
    
    // 5. Automatic Cleanup for stale/invalid tokens
    const isStaleToken = 
      errorCode === "messaging/registration-token-not-registered" || 
      errorCode === "messaging/invalid-registration-token" ||
      errorMessage.includes("Requested entity was not found");

    if (isStaleToken) {
      console.warn(`[Push] Cleaning up invalid token for ${uuid} due to error: ${errorCode}`);
      try {
        await defaultDB.collection(FCM_TOKENS_COLLECTION).doc(uuid).delete();
      } catch (dbErr) {
        console.error(`[Push] Failed to delete stale token record:`, dbErr.message);
      }
    }

    console.error(`[Push Error] Failed for user ${uuid}:`, errorMessage);
    return null;
  }
};