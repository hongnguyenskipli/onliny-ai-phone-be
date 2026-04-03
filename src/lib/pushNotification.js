import { getMessaging } from "firebase-admin/messaging";
import { defaultDB } from "../server/db.js";

const MAX_RETRY = 2;

/**
 * Ensure all FCM data payload values are strings
 */
const sanitizeData = (data) => {
  const result = {};
  for (const key in data) {
    const val = data[key];
    result[key] = typeof val === "string" ? val : JSON.stringify(val);
  }
  return result;
};

/**
 * Send FCM with retry + token invalid handling
 */
const sendFCM = async (token, message, retry = MAX_RETRY) => {
  for (let i = 0; i <= retry; i++) {
    try {
      return await getMessaging().send(message);
    } catch (err) {
      const code = err?.errorInfo?.code;

      // Token invalid → stop & signal cleanup
      if (code === "messaging/registration-token-not-registered") {
        throw { type: "TOKEN_INVALID" };
      }

      if (i === retry) throw err;

      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
};

/**
 * SMS + FCM Signal only (NO SOCKET)
 */
export const sendPushToUser = async (uuid, data) => {
  try {
    // Validate input
    if (!uuid || !data?.type) {
      console.log("[PUSH] Invalid payload");
      return { success: false };
    }

    // Get token
    const tokenDoc = await defaultDB
      .collection("fcm_tokens")
      .doc(uuid)
      .get();

    if (!tokenDoc.exists) {
      console.log(`[PUSH] No token for ${uuid}`);
      return { success: false, reason: "no_token" };
    }

    const { token } = tokenDoc.data() || {};
    if (!token) {
      console.log(`[PUSH] Empty token for ${uuid}`);
      return { success: false, reason: "invalid_token" };
    }

    // Build FCM signal (NOT full message)
    const message = {
      token,
      data: sanitizeData({
        ...data,
        timestamp: new Date().toISOString(),
      }),
    };

    // Send
    const response = await sendFCM(token, message);

    console.log(`[PUSH] Signal sent → ${uuid}: ${data.type}`);

    return {
      success: true,
      channel: "fcm",
      messageId: response,
    };

  } catch (err) {
    // Cleanup invalid token
    if (err?.type === "TOKEN_INVALID") {
      await defaultDB.collection("fcm_tokens").doc(uuid).delete();
      console.log(`[PUSH] Removed invalid token for ${uuid}`);
      return { success: false, reason: "token_invalid" };
    }

    console.error(`[PUSH] Failed for ${uuid}:`, err.message);

    return { success: false };
  }
};