import https from "https";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { defaultDB } from "../../server/db.js";
import { USER_NUMBERS_COLLECTION } from "../../constants/index.js";

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

export const mapCall = (call) => ({
  id: call.sid,
  callerName: call.callerName || call.from,
  callerNumber: call.direction === "inbound" ? call.from : call.to,
  status: isMissed(call.status) ? "missed" : call.status,
  startTime: call.startTime?.toISOString() || null,
  duration: formatDuration(call.duration),
  direction: call.direction === "inbound" ? "incoming" : "outgoing",
  hasRecording: false,
});

export const getUserPhoneNumber = async (uuid) => {
  if (!uuid) return null;
  const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
  if (doc.exists) return doc.data().phone_number;
  return null;
};

export const getCallerIdByEmail = async (email) => {
  try {
    const snapshot = await defaultDB
      .collection(USER_NUMBERS_COLLECTION)
      .where("userEmail", "==", email)
      .limit(1)
      .get();
    if (!snapshot.empty) return snapshot.docs[0].data().phone_number;
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

export const verifyJwtToken = (token) => {
  if (!token) return { valid: false, error: "missing" };
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.name };
  }
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
