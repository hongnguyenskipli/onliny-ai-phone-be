import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defaultDB } from "../../server/db.js";
import {
  MESSAGES_COLLECTION,
  VOICE_BINDINGS_COLLECTION
} from "../../../constants/index.js";
import { sendPushToUser } from "../../pushNotification.js";

const STATUS_WEIGHT = {
  sending: 0,
  sent: 1,
  delivered: 2,
  seen: 3,
  failed: 4, // terminal
};

const isValidStatus = (status) => STATUS_WEIGHT.hasOwnProperty(status);

export const chatService = {
  async getUuidByPhone(phoneNumber) {
    if (!phoneNumber) return null;

    const doc = await defaultDB
      .collection(VOICE_BINDINGS_COLLECTION)
      .doc(phoneNumber)
      .get();

    return doc.exists ? doc.data().uuid : null;
  },

  async saveMessage(msgData) {
    const { twilioSid, tempId, status } = msgData;

    if (!twilioSid && !tempId) {
      throw new Error("Missing identifier");
    }

    if (!isValidStatus(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const docId = twilioSid || `temp_${tempId}`;
    const msgRef = defaultDB.collection(MESSAGES_COLLECTION).doc(docId);

    return await defaultDB.runTransaction(async (t) => {
      const doc = await t.get(msgRef);

      if (doc.exists) {
        const existing = doc.data();

        const existingWeight = STATUS_WEIGHT[existing.status] ?? 0;
        const newWeight = STATUS_WEIGHT[status] ?? 0;

        // ❗ Prevent downgrade & protect terminal state
        if (existing.status === "failed") {
          return existing;
        }

        if (newWeight <= existingWeight) {
          return existing;
        }

        const updateData = {
          ...msgData,
          updatedAt: FieldValue.serverTimestamp(),
        };

        t.update(msgRef, updateData);
        return { ...existing, ...updateData };

      } else {
        const newData = {
          ...msgData,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        t.set(msgRef, newData);
        return newData;
      }
    });
  },

  async getHistory(userUuid, contactNumber, since = null, cursor = null) {
    if (!userUuid || !contactNumber) return [];

    let query = defaultDB
      .collection(MESSAGES_COLLECTION)
      .where("conversationId", "==", contactNumber)
      .where("participants", "array-contains", userUuid)
      .orderBy("updatedAt", "asc");

    // Delta sync
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate)) {
        query = query.where(
          "updatedAt",
          ">",
          Timestamp.fromDate(sinceDate)
        );
      }
    }

    // Pagination
    if (cursor) {
      const cursorDoc = await defaultDB
        .collection(MESSAGES_COLLECTION)
        .doc(cursor)
        .get();

      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.limit(50).get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  },

  async triggerSignal(targetUuid, type, conversationId, fromNumber) {
    if (!targetUuid || !type) return;

    return await sendPushToUser(targetUuid, {
      type,
      conversationId,
      from: fromNumber,
    });
  },
};
