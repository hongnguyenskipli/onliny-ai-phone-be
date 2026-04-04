import { defaultDB } from "../../../server/db.js";
import { VOICE_BINDINGS_COLLECTION } from "../../../constants/index.js";
import { sendPushToUser } from "../../pushNotification.js";

const phoneCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

export const chatService = {
  async getUuidByPhone(phoneNumber) {
    if (!phoneNumber) return null;

    const normalizedPhone = this._normalizePhone(phoneNumber);
    
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
    }
  },

  _normalizePhone(phone) {
    if (!phone) return phone;
    return phone.toString().replace(/[^\d+]/g, '');
  },

  clearCache() {
    phoneCache.clear();
  }
};

setInterval(() => {
  chatService.clearCache();
}, 60 * 60 * 1000);
