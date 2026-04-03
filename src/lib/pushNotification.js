import { getMessaging } from "firebase-admin/messaging";
import { defaultDB } from "../server/db.js";
import { emitToUser, isUserOnline } from "./socketHandler.js";


export const sendPushToUser = async (uuid, data) => {
  // FCM and Socket communication updates deleted.
  // This service no longer sends real-time notifications for calls or messages.
  console.log(`[PUSH] Notification suppressed for user ${uuid}: ${data.type}`);
  return;
};

/**
 * Map data.type from business logic to socket event names.
 */
const mapDataTypeToSocketEvent = (type) => {
  const mapping = {
    CALL_UPDATE: "call_status_changed",
    MESSAGE_NEW: "new_message",
    DASHBOARD_UPDATE: "dashboard_update",
  };
  return mapping[type] || null;
};
