import { getMessaging } from "firebase-admin/messaging";
import { defaultDB } from "../server/db.js";
import { emitToUser, isUserOnline } from "./socketHandler.js";


export const sendPushToUser = async (uuid, data) => {
  // ── 1. Socket.io (instant, if user is online) ───────────────
  const socketEvent = mapDataTypeToSocketEvent(data.type);
  if (socketEvent) {
    const delivered = emitToUser(uuid, socketEvent, data);
    if (delivered) {
      console.log(`[PUSH] Socket.io delivered "${socketEvent}" to ${uuid}`);
    }
  }

  // ── 2. FCM (background fallback — always send) ──────────────
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

    console.log(`[PUSH] FCM sent to user ${uuid}:`, data);
  } catch (err) {
    console.error(`[PUSH] FCM failed for ${uuid}:`, err.message);
  }
};

/**
 * Map data.type from business logic to socket event names.
 */
const mapDataTypeToSocketEvent = (type) => {
  const mapping = {
    call_update: "call_status_changed",
    sms_received: "new_message",
    dashboard_update: "dashboard_update",
  };
  return mapping[type] || null;
};
