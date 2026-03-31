import https from "https";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { defaultDB } from "../../server/db.js";
import { USER_NUMBERS_COLLECTION, MISSED_CALL_SMS_COLLECTION, CALL_RESULTS_COLLECTION } from "../../constants/index.js";

const _twilioClient = { current: null };
export const getTwilioClient = () => {
  if (!_twilioClient.current) {
    _twilioClient.current = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient.current;
};

export const formatDuration = (seconds) => {
  const s = parseInt(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
};

export const isMissed = (status) => ["no-answer", "busy", "canceled", "failed"].includes(status);

export const mapCall = (call) => {
  const isIncoming = call.direction === "inbound";
  const otherNumber = isIncoming ? call.from : call.to;
  const otherName = call.callerName || otherNumber;
  return {
    id: call.sid,
    callerName: otherName,
    callerNumber: otherNumber,
    status: isMissed(call.status) ? "missed" : call.status,
    startTime: call.startTime?.toISOString() || null,
    duration: formatDuration(call.duration),
    direction: isIncoming ? "incoming" : "outgoing",
    hasRecording: false,
    smsSent: isSmsSentForCall(call.sid),
  };
};

export const getUserPhoneNumber = async (uuid) => {
  if (!uuid) return null;
  const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
  if (doc.exists) return doc.data().phone_number;
  return null;
};

export const getCallerIdByIdentity = async (identity) => {
  try {
    const uuid = identity.replace(/_/g, "-");
    const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
    if (doc.exists) return doc.data().phone_number;
  } catch (_) {
    // ignore
  }
  return process.env.TWILIO_PHONE_NUMBER;
};

export const callAmdState = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [sid, state] of callAmdState.entries()) {
    if (state.timestamp < cutoff) callAmdState.delete(sid);
  }
}, 5 * 60 * 1000);

const _cache = new Map();
const CACHE_TTL = 60_000;

export const cacheGet = (key) => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
};

export const cacheSet = (key, data) => _cache.set(key, { data, ts: Date.now() });
export const cacheDelete = (key) => _cache.delete(key);

// Global Auto-Cleanup for Memory Leak Prevention (Every 1 hour)
setInterval(() => {
  const cutoff2Hours = Date.now() - 2 * 60 * 60 * 1000;
  
  // Clean _smsSentByCallSid
  for (const [sid, timestamp] of _smsSentByCallSid.entries()) {
    if (timestamp < cutoff2Hours) _smsSentByCallSid.delete(sid);
  }
  
  // Clean _missedCallSids
  for (const [sid, timestamp] of _missedCallSids.entries()) {
    if (timestamp < cutoff2Hours) _missedCallSids.delete(sid);
  }

  // Clean _cache
  for (const [key, entry] of _cache.entries()) {
    if (Date.now() - entry.ts > CACHE_TTL) {
      _cache.delete(key);
    }
  }
}, 60 * 60 * 1000);

export const verifyJwtToken = (token) => {
  if (!token) return { valid: false, error: "missing" };
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.name };
  }
};

export const sendSMS = async (to, body, from) => {
  const client = getTwilioClient();
  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;
  return client.messages.create({
    to,
    from: fromNumber,
    body,
  });
};

const _smsSentByCallSid = new Map();

export const markSmsSentForCall = async (callSid, callerNumber, calledNumber, smsSid) => {
  _smsSentByCallSid.set(callSid, Date.now());
  try {
    await defaultDB.collection(MISSED_CALL_SMS_COLLECTION).doc(callSid).set({
      callSid,
      callerNumber,
      calledNumber,
      smsSid,
      sentAt: new Date().toISOString(),
      status: "sent",
    });
  } catch (err) {
    console.error("[SMS] Failed to save to Firebase:", err.message);
  }
};

// ── Rejected Call Tracking (user explicitly denied) ──────────
// When user taps "Deny", frontend calls markCallRejected() so
// we skip auto-reply SMS for intentionally rejected calls.
const _rejectedCallSids = new Set();

export const markCallRejected = (callSid) => {
  if (!callSid) return;
  _rejectedCallSids.add(callSid);
  // Auto-cleanup after 10 minutes
  setTimeout(() => _rejectedCallSids.delete(callSid), 10 * 60 * 1000);
};

export const isCallRejected = (callSid) => {
  return _rejectedCallSids.has(callSid);
};

// ── Missed Call Tracking (by CallSid, NOT callerNumber) ──────
// OLD BUG: wasCallerMissed() tracked by callerNumber — if ONE call
// from a number was missed, ALL calls from that number in 5min
// showed as "missed" (including completed ones).
// FIX: Track by callSid only. markCallerMissed is kept for
// backward compat but no longer contaminates other calls.
const _callerMissedLog = [];
const CALLER_MISSED_WINDOW_MS = 5 * 60 * 1000;

export const markCallerMissed = (callerNumber) => {
  if (!callerNumber) return;
  _callerMissedLog.push({ callerNumber, timestamp: Date.now() });
  const cutoff = Date.now() - CALLER_MISSED_WINDOW_MS;
  while (_callerMissedLog.length > 0 && _callerMissedLog[0].timestamp < cutoff) {
    _callerMissedLog.shift();
  }
};

// DEPRECATED: No longer used in enrichWithSmsStatus. Kept for reference.
export const wasCallerMissed = (callerNumber, callStartTimeISO) => {
  return false;
};

const _missedCallSids = new Map();

export const markCallMissed = async (callSid) => {
  _missedCallSids.set(callSid, Date.now());
  try {
    await defaultDB.collection(CALL_RESULTS_COLLECTION).doc(callSid).set({
      callSid,
      missed: true,
      recordedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CALL_RESULTS] Failed to save to Firebase:", err.message);
  }
};

export const isCallMissed = async (callSid) => {
  if (_missedCallSids.has(callSid)) return true;
  try {
    const doc = await defaultDB.collection(CALL_RESULTS_COLLECTION).doc(callSid).get();
    if (doc.exists && doc.data().missed) {
      _missedCallSids.set(callSid, Date.now());
      return true;
    }
  } catch (err) {
    console.error("[CALL_RESULTS] Failed to check Firebase:", err.message);
  }
  return false;
};

export const isSmsSentForCall = async (callSid) => {
  if (_smsSentByCallSid.has(callSid)) {
    return true;
  }
  try {
    const doc = await defaultDB.collection(MISSED_CALL_SMS_COLLECTION).doc(callSid).get();
    if (doc.exists) {
      _smsSentByCallSid.set(callSid, Date.now());
      return true;
    }
  } catch (err) {
    console.error("[SMS] Failed to check Firebase:", err.message);
  }
  return false;
};

export const streamRecording = (recordingSid, authHeader, res) => {
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const upstreamHeaders = { Authorization: `Basic ${auth}` };
  if (authHeader?.range) {
    upstreamHeaders["Range"] = authHeader.range;
  }

  const proxyReq = https.request(twilioUrl, { headers: upstreamHeaders }, (twilioRes) => {
    const statusCode = twilioRes.statusCode || 200;
    res.status(statusCode);
    res.setHeader("Content-Type", twilioRes.headers["content-type"] || "audio/mpeg");
    res.setHeader("Content-Disposition", `inline; filename="${recordingSid}.mp3"`);
    res.setHeader("Accept-Ranges", "bytes");
    if (twilioRes.headers["content-length"]) {
      res.setHeader("Content-Length", twilioRes.headers["content-length"]);
    }
    if (twilioRes.headers["content-range"]) {
      res.setHeader("Content-Range", twilioRes.headers["content-range"]);
    }
    twilioRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ message: "Failed to stream recording." });
    }
  });

  proxyReq.end();
};
