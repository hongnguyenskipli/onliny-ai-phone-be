/**
 * socketHandler.js
 *
 * Socket.io server handler for Callr Backend.
 * Features:
 *  - JWT authentication on handshake
 *  - User room mapping (uuid → socket room)
 *  - emitToUser(uuid, event, data) — send to specific user
 *  - Message ACK support
 *  - Ping/Pong heartbeat (built-in socket.io)
 */

import { Server } from "socket.io";
import jwt from "jsonwebtoken";

// Map: uuid → Set<socketId> (user can have multiple connections/devices)
const _userSockets = new Map();

let _io = null;

/**
 * Initialize Socket.io on the existing HTTP server.
 * @param {import("http").Server} httpServer
 * @returns {import("socket.io").Server}
 */
export const initSocketIO = (httpServer) => {
  _io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    // Ping/Pong heartbeat config
    pingInterval: 25000,  // Send ping every 25s
    pingTimeout: 10000,   // Wait 10s for pong before disconnect
    transports: ["websocket", "polling"],
  });

  // ── JWT Authentication Middleware ──────────────────────────
  _io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("unauthorized: missing token"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.uuid || !decoded.email) {
        return next(new Error("unauthorized: invalid token payload"));
      }
      socket.user = { uuid: decoded.uuid, email: decoded.email };
      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return next(new Error("unauthorized: token expired"));
      }
      return next(new Error("unauthorized: invalid token"));
    }
  });

  // ── Connection Handler ────────────────────────────────────
  _io.on("connection", (socket) => {
    const { uuid } = socket.user;
    console.log(`[Socket.io] User connected: ${uuid} (socket: ${socket.id})`);

    // Join user's personal room
    socket.join(`user:${uuid}`);

    // Track socket IDs per user
    if (!_userSockets.has(uuid)) {
      _userSockets.set(uuid, new Set());
    }
    _userSockets.get(uuid).add(socket.id);

    // ── Message ACK from client ───────────────────────────
    socket.on("message_ack", (data) => {
      console.log(`[Socket.io] ACK received from ${uuid}:`, data?.messageId);
      // Server-side: mark message as delivered if needed
      // For now, just acknowledge back
      socket.emit("message_ack_confirmed", {
        messageId: data?.messageId,
        status: "delivered",
      });
    });

    // ── Sync Data Request ─────────────────────────────────
    socket.on("sync_data", (data) => {
      console.log(`[Socket.io] Sync request from ${uuid}:`, data);
      // Client reconnected and wants to catch up.
      // In a full implementation, query missing messages since lastMessageId.
      // For now, tell client to do a full refresh via API.
      socket.emit("sync_data_response", {
        action: "full_refresh",
        lastMessageId: data?.lastMessageId,
      });
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      console.log(`[Socket.io] User disconnected: ${uuid} (reason: ${reason})`);
      const sockets = _userSockets.get(uuid);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          _userSockets.delete(uuid);
        }
      }
    });
  });

  console.log("[Socket.io] Server initialized");
  return _io;
};

/**
 * Get the Socket.io server instance.
 */
export const getIO = () => _io;

/**
 * Emit an event to a specific user (all their connected devices/tabs).
 * @param {string} uuid - User UUID
 * @param {string} event - Event name (e.g., 'new_message', 'call_status_changed')
 * @param {Object} data - Event payload
 * @returns {boolean} true if user has active socket connections
 */
export const emitToUser = (uuid, event, data) => {
  if (!_io) {
    console.warn("[Socket.io] Server not initialized, cannot emit.");
    return false;
  }
  const room = `user:${uuid}`;
  _io.to(room).emit(event, data);

  const hasActiveSockets = _userSockets.has(uuid) && _userSockets.get(uuid).size > 0;
  if (hasActiveSockets) {
    console.log(`[Socket.io] Emitted "${event}" to ${uuid}`);
  }
  return hasActiveSockets;
};

/**
 * Check if a user has active socket connections.
 * Useful to decide whether to also send FCM push.
 */
export const isUserOnline = (uuid) => {
  return _userSockets.has(uuid) && _userSockets.get(uuid).size > 0;
};
