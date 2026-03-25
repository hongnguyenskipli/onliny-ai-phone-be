import { getMessaging } from "firebase-admin/messaging";
import { defaultDB } from "../server/db.js";

export const sendPushToUser = async (uuid, data) => {
  try {
    const doc = await defaultDB.collection("fcm_tokens").doc(uuid).get();
    if (!doc.exists) return;

    const { token } = doc.data();

    await getMessaging().send({
      token,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: "high",
      },
    });

    console.log(`[PUSH] Sent to user ${uuid}:`, data);
  } catch (err) {
    console.error(`[PUSH] Failed for ${uuid}:`, err.message);
  }
};
