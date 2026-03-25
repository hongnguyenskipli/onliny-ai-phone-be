import { defaultDB } from "../../../server/db.js";
import { AUTO_REPLY_COLLECTION, VOICE_BINDINGS_COLLECTION } from "../../../constants/index.js";

const DEFAULT_MISSED_CALL_MESSAGE = "Hi! Sorry we missed your call — we'll get back to you as soon as possible. Thank you!";

export const getAutoReplyService = async ({ uuid, db = defaultDB }) => {
  const doc = await db.collection(AUTO_REPLY_COLLECTION).doc(uuid).get();
  if (!doc.exists) {
    return {
      success: true,
      data: {
        missedCallMessage: DEFAULT_MISSED_CALL_MESSAGE,
        enabled: true,
        isDefault: true,
      },
    };
  }
  return { success: true, data: doc.data() };
};

export const upsertAutoReplyService = async ({ uuid, missedCallMessage, enabled, db = defaultDB }) => {
  const data = {
    uuid,
    missedCallMessage: missedCallMessage || DEFAULT_MISSED_CALL_MESSAGE,
    enabled: enabled !== undefined ? enabled : true,
    updatedAt: new Date().toISOString(),
  };

  await db.collection(AUTO_REPLY_COLLECTION).doc(uuid).set(data, { merge: true });
  return { success: true, data };
};

export const getAutoReplyByPhoneNumber = async ({ phoneNumber, db = defaultDB }) => {
  try {
    const bindingDoc = await db.collection(VOICE_BINDINGS_COLLECTION).doc(phoneNumber).get();
    if (!bindingDoc.exists) return null;

    const { uuid } = bindingDoc.data();
    if (!uuid) return null;

    const doc = await db.collection(AUTO_REPLY_COLLECTION).doc(uuid).get();
    if (!doc.exists) {
      return {
        missedCallMessage: DEFAULT_MISSED_CALL_MESSAGE,
        enabled: true,
      };
    }

    return doc.data();
  } catch (err) {
    console.error("[AUTO_REPLY] Failed to get by phone number:", err.message);
    return null;
  }
};

export const createDefaultAutoReply = async ({ uuid, db = defaultDB }) => {
  const existing = await db.collection(AUTO_REPLY_COLLECTION).doc(uuid).get();
  if (existing.exists) return { success: true, data: existing.data() };

  const data = {
    uuid,
    missedCallMessage: DEFAULT_MISSED_CALL_MESSAGE,
    enabled: true,
    updatedAt: new Date().toISOString(),
  };

  await db.collection(AUTO_REPLY_COLLECTION).doc(uuid).set(data);
  return { success: true, data };
};
