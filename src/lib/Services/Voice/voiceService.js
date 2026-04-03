import { defaultDB, defaultMessaging } from "../../../server/db.js";
import { 
  VOICE_BINDINGS_COLLECTION,
  FCM_TOKENS_COLLECTION 
} from "../../../constants/index.js";
import { chatService } from "../Chat/chatService.js";

// Configuration
const CALL_PUSH_CONFIG = {
  ttl: 30, // 30 seconds - enough time for brief network issues
  priority: "high",
  maxRetries: 2,
  retryDelay: 1000, // 1 second
};

export const voiceService = {
  /**
   * Send High-Priority FCM push notification for incoming call.
   * Supports multiple devices and handles iOS VoIP + Android data messages.
   */
  async sendCallPush(targetUuid, callData) {
    if (!targetUuid) {
      console.warn("[VoicePush] No target UUID provided");
      return null;
    }

    // Validate call data
    if (!this._validateCallData(callData)) {
      console.error("[VoicePush] Invalid call data:", callData);
      return null;
    }

    try {
      // Get all active FCM tokens for the user (multi-device support)
      const tokens = await this._getUserFcmTokens(targetUuid);
      
      if (tokens.length === 0) {
        console.warn(`[VoicePush] No FCM tokens found for user: ${targetUuid}`);
        return null;
      }

      // Send to all devices in parallel
      const results = await Promise.allSettled(
        tokens.map(tokenData => 
          this._sendToDevice(tokenData, callData, targetUuid)
        )
      );

      // Process results and cleanup failed tokens
      const successful = results.filter(r => r.status === "fulfilled" && r.value).length;
      const failed = results.length - successful;

      console.log(`[VoicePush] Sent to ${targetUuid}: ${successful} succeeded, ${failed} failed`);

      return {
        successful,
        failed,
        total: results.length,
        results: results.map(r => r.status === "fulfilled" ? r.value : r.reason)
      };

    } catch (error) {
      console.error(`[VoicePush] Error sending push to ${targetUuid}:`, error);
      return null;
    }
  },

  /**
   * Send push to a single device with retry logic
   */
  async _sendToDevice(tokenData, callData, targetUuid) {
    const { token, platform, deviceId } = tokenData;

    for (let attempt = 0; attempt <= CALL_PUSH_CONFIG.maxRetries; attempt++) {
      try {
        const message = this._buildMessage(token, callData, platform);
        const response = await defaultMessaging.send(message);
        
        console.log(`[VoicePush] Sent to device ${deviceId} (${platform}):`, response);
        return { success: true, deviceId, messageId: response };

      } catch (error) {
        // Handle specific FCM errors
        if (this._isTokenError(error)) {
          console.warn(`[VoicePush] Invalid token for device ${deviceId}, removing...`);
          await this._removeInvalidToken(targetUuid, deviceId);
          return { success: false, deviceId, error: "invalid_token" };
        }

        // Retry on transient errors
        if (attempt < CALL_PUSH_CONFIG.maxRetries) {
          console.warn(`[VoicePush] Retry ${attempt + 1} for device ${deviceId}`);
          await this._delay(CALL_PUSH_CONFIG.retryDelay * (attempt + 1));
          continue;
        }

        console.error(`[VoicePush] Failed to send to device ${deviceId}:`, error.message);
        return { success: false, deviceId, error: error.message };
      }
    }
  },

  /**
   * Build platform-specific FCM message
   */
  _buildMessage(token, callData, platform = "android") {
    const baseData = {
      type: "INCOMING_CALL",
      callSid: callData.callSid,
      senderNumber: callData.from,
      recipientNumber: callData.to,
      callerName: callData.callerName || callData.from,
      timestamp: new Date().toISOString(),
    };

    const message = {
      token,
      data: baseData,
      android: {
        priority: CALL_PUSH_CONFIG.priority,
        ttl: CALL_PUSH_CONFIG.ttl * 1000, // Convert to milliseconds
        restrictedPackageName: process.env.ANDROID_PACKAGE_NAME,
      },
    };

    // iOS configuration
    if (platform === "ios") {
      message.apns = {
        headers: {
          "apns-priority": "10", // High priority
          "apns-push-type": "background", // Or "voip" if using VoIP certificates
          "apns-expiration": String(Math.floor(Date.now() / 1000) + CALL_PUSH_CONFIG.ttl),
        },
        payload: {
          aps: {
            "content-available": 1,
            sound: "default", // Optional: play sound for call
            badge: 1,
          },
          // Include call data in payload for iOS
          callData: baseData,
        },
      };
    }

    return message;
  },

  /**
   * Get all active FCM tokens for a user
   */
  async _getUserFcmTokens(uuid) {
    try {
      // Primary token (legacy single-device support)
      const primaryDoc = await defaultDB
        .collection(FCM_TOKENS_COLLECTION || "fcm_tokens")
        .doc(uuid)
        .get();

      const tokens = [];

      if (primaryDoc.exists && primaryDoc.data().token) {
        tokens.push({
          token: primaryDoc.data().token,
          platform: primaryDoc.data().platform || "android",
          deviceId: "primary",
        });
      }

      // Multi-device tokens (if using subcollection pattern)
      const devicesSnapshot = await defaultDB
        .collection(FCM_TOKENS_COLLECTION || "fcm_tokens")
        .doc(uuid)
        .collection("devices")
        .get();

      devicesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.token && data.active !== false) {
          tokens.push({
            token: data.token,
            platform: data.platform || "android",
            deviceId: doc.id,
            lastUsed: data.lastUsed,
          });
        }
      });

      return tokens;
    } catch (error) {
      console.error(`[VoicePush] Error fetching tokens for ${uuid}:`, error);
      return [];
    }
  },

  /**
   * Validate call data structure
   */
  _validateCallData(callData) {
    if (!callData || typeof callData !== "object") return false;
    
    const required = ["callSid", "from", "to"];
    return required.every(field => callData[field] && typeof callData[field] === "string");
  },

  /**
   * Check if error indicates invalid/expired token
   */
  _isTokenError(error) {
    const tokenErrors = [
      "registration-token-not-registered",
      "invalid-registration-token",
      "invalid-argument",
    ];
    return tokenErrors.some(err => error.code?.includes(err) || error.message?.includes(err));
  },

  /**
   * Remove invalid FCM token from database
   */
  async _removeInvalidToken(uuid, deviceId) {
    try {
      if (deviceId === "primary") {
        await defaultDB
          .collection(FCM_TOKENS_COLLECTION || "fcm_tokens")
          .doc(uuid)
          .update({ token: null, invalidatedAt: new Date().toISOString() });
      } else {
        await defaultDB
          .collection(FCM_TOKENS_COLLECTION || "fcm_tokens")
          .doc(uuid)
          .collection("devices")
          .doc(deviceId)
          .delete();
      }
      console.log(`[VoicePush] Removed invalid token for ${uuid}/${deviceId}`);
    } catch (error) {
      console.error(`[VoicePush] Error removing token:`, error);
    }
  },

  /**
   * Utility delay function
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Find the user UUID associated with a Twilio phone number
   */
  async getUuidByPhone(phoneNumber) {
    if (!phoneNumber) return null;
    
    try {
      // Reuse chatService normalization and lookup logic
      return await chatService.getUuidByPhone(phoneNumber);
    } catch (error) {
      console.error(`[VoiceService] Error looking up UUID for ${phoneNumber}:`, error);
      return null;
    }
  },

  /**
   * Register voice binding (for Twilio Voice SDK)
   */
  async registerVoiceBinding(uuid, identity, bindingData) {
    if (!uuid || !identity) return null;

    try {
      await defaultDB
        .collection(VOICE_BINDINGS_COLLECTION)
        .doc(uuid)
        .set({
          identity,
          ...bindingData,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

      console.log(`[VoiceService] Registered voice binding for ${uuid}`);
      return true;
    } catch (error) {
      console.error(`[VoiceService] Error registering voice binding:`, error);
      return false;
    }
  },

  /**
   * Get voice binding for a user
   */
  async getVoiceBinding(uuid) {
    if (!uuid) return null;

    try {
      const doc = await defaultDB
        .collection(VOICE_BINDINGS_COLLECTION)
        .doc(uuid)
        .get();

      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error(`[VoiceService] Error getting voice binding:`, error);
      return null;
    }
  },

  /**
   * Cleanup stale FCM tokens (run periodically)
   */
  async cleanupStaleTokens(maxAgeMs = 90 * 24 * 60 * 60 * 1000) { // 90 days
    try {
      const cutoffDate = new Date(Date.now() - maxAgeMs).toISOString();
      
      const snapshot = await defaultDB
        .collection(FCM_TOKENS_COLLECTION || "fcm_tokens")
        .where("lastUsed", "<", cutoffDate)
        .get();

      const batch = defaultDB.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`[VoiceService] Cleaned up ${snapshot.size} stale tokens`);
      return snapshot.size;
    } catch (error) {
      console.error("[VoiceService] Error cleaning up stale tokens:", error);
      return 0;
    }
  }
};