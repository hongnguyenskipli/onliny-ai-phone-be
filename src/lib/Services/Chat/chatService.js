import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
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
  failed: 4,
};

const ALLOWED_MESSAGE_FIELDS = [
  'twilioSid', 'tempId', 'status', 'body', 'from', 
  'to', 'conversationId', 'participants', 'type', 'mediaUrl'
];

const isValidStatus = (status) => STATUS_WEIGHT.hasOwnProperty(status);

// Simple in-memory cache
const phoneCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

export const chatService = {
  async getUuidByPhone(phoneNumber) {
    if (!phoneNumber) return null;

    const normalizedPhone = this._normalizePhone(phoneNumber);
    
    // Check cache
    const cached = phoneCache.get(normalizedPhone);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.uuid;
    }

    const doc = await defaultDB
      .collection(VOICE_BINDINGS_COLLECTION)
      .doc(normalizedPhone)
      .get();

    const uuid = doc.exists ? doc.data().uuid : null;
    
    phoneCache.set(normalizedPhone, { uuid, timestamp: Date.now() });
    
    return uuid;
  },

  async saveMessage(msgData, retries = 3) {
    const { twilioSid, tempId, status } = msgData;

    if (!twilioSid && !tempId) {
      throw new Error("Missing identifier");
    }

    if (!isValidStatus(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // Normalize conversationId
    if (msgData.conversationId) {
      msgData.conversationId = this._normalizePhone(msgData.conversationId);
    }

    // Migrate temp message if needed
    if (twilioSid && tempId) {
      await this._migrateTempMessage(tempId, twilioSid);
    }

    // Retry logic for transaction conflicts
    for (let i = 0; i < retries; i++) {
      try {
        return await this._saveMessageTransaction(msgData);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 100));
      }
    }
  },

  async _saveMessageTransaction(msgData) {
    const { twilioSid, tempId, status } = msgData;
    const docId = twilioSid || `temp_${tempId}`;
    const msgRef = defaultDB.collection(MESSAGES_COLLECTION).doc(docId);

    // Sanitize input
    const sanitized = this._sanitizeMessageData(msgData);

    return await defaultDB.runTransaction(async (t) => {
      const doc = await t.get(msgRef);

      if (doc.exists) {
        const existing = doc.data();

        // Terminal state protection
        if (existing.status === "failed") {
          return existing;
        }

        // Prevent status downgrade
        const existingWeight = STATUS_WEIGHT[existing.status] ?? 0;
        const newWeight = STATUS_WEIGHT[status] ?? 0;

        if (newWeight <= existingWeight) {
          return existing;
        }

        const updateData = {
          ...sanitized,
          updatedAt: FieldValue.serverTimestamp(),
        };

        t.update(msgRef, updateData);
        return { ...existing, ...updateData };

      } else {
        const newData = {
          ...sanitized,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        t.set(msgRef, newData);
        return newData;
      }
    });
  },

  async _migrateTempMessage(tempId, twilioSid) {
    const tempRef = defaultDB.collection(MESSAGES_COLLECTION).doc(`temp_${tempId}`);
    const finalRef = defaultDB.collection(MESSAGES_COLLECTION).doc(twilioSid);

    try {
      return await defaultDB.runTransaction(async (t) => {
        const tempDoc = await t.get(tempRef);
        if (!tempDoc.exists) return;

        const finalDoc = await t.get(finalRef);
        if (finalDoc.exists) return;

        t.set(finalRef, {
          ...tempDoc.data(),
          twilioSid,
          migratedFrom: `temp_${tempId}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
        t.delete(tempRef);
      });
    } catch (error) {
      console.error('[Chat] Migration failed:', error);
      // Don't throw, let saveMessage continue
    }
  },

  async getHistory(userUuid, contactNumber, since = null, limit = 50) {
    if (!userUuid || !contactNumber) {
      throw new Error('Missing required parameters');
    }

    const normalizedNumber = this._normalizePhone(contactNumber);
    
    let query = defaultDB
      .collection(MESSAGES_COLLECTION)
      .where("conversationId", "==", normalizedNumber)
      .where("participants", "array-contains", userUuid)
      .orderBy("createdAt", "desc")
      .limit(limit);

    // Delta sync by createdAt
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate)) {
        query = query.where(
          "createdAt",
          ">",
          Timestamp.fromDate(sinceDate)
        );
      }
    }

    try {
      const snapshot = await query.get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      console.error('[Chat] getHistory error:', error);
      throw error;
    }
  },

  async triggerSignal(targetUuid, type, conversationId, fromNumber) {
    if (!targetUuid || !type) {
      console.warn('[Chat] triggerSignal: missing params');
      return;
    }

    try {
      return await sendPushToUser(targetUuid, {
        type,
        conversationId: this._normalizePhone(conversationId),
        senderNumber: fromNumber,
      });
    } catch (error) {
      console.error('[Chat] triggerSignal error:', error);
      // Don't throw - push notification failure shouldn't break flow
    }
  },

  _normalizePhone(phone) {
    if (!phone) return phone;
    // Remove all non-digits, keep leading +
    return phone.toString().replace(/[^\d+]/g, '');
  },

  _sanitizeMessageData(data) {
    return Object.keys(data)
      .filter(key => ALLOWED_MESSAGE_FIELDS.includes(key))
      .reduce((obj, key) => {
        obj[key] = data[key];
        return obj;
      }, {});
  },

  // Cleanup cache periodically
  clearCache() {
    phoneCache.clear();
  }
};

// Auto cleanup cache every hour
setInterval(() => {
  chatService.clearCache();
}, 60 * 60 * 1000);