import https from "https";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { defaultDB } from "../../server/db.js";
import {
  USER_NUMBERS_COLLECTION,
} from "../../constants/index.js";

/* ================= TWILIO ================= */

let _twilioClient = null;

export const getTwilioClient = () => {
  if (!_twilioClient) {
    _twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return _twilioClient;
};

/* ================= AMD & STATE ================= */

export const callAmdState = new Map();

// Cleanup AMD state periodically to prevent memory leaks
const AMD_STATE_TTL = 3600000; // 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of callAmdState.entries()) {
    if (value.timestamp && now - value.timestamp > AMD_STATE_TTL) {
      callAmdState.delete(key);
    }
  }
}, 600000); // Clean every 10 minutes

/* ================= UTIL ================= */

export const formatDuration = (seconds) => {
  const s = Number.isFinite(+seconds) ? parseInt(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
};

export const isMissed = (status) =>
  ["no-answer", "busy", "canceled", "failed"].includes(status);

/* ================= CALL MAPPER ================= */

export const mapCall = (call, userPhoneNumber = null) => {
  if (!call || !call.sid) return null;

  let isIncoming;

  if (userPhoneNumber) {
    const cleanTo = call.to?.replace("client:", "") || "";
    const cleanUser = userPhoneNumber.replace("client:", "");
    isIncoming = cleanTo === cleanUser;
  } else {
    isIncoming = call.direction === "inbound";
  }

  const otherRaw = isIncoming ? call.from : call.to;
  const otherNumber = otherRaw?.replace("client:", "") || "";

  return {
    id: call.sid,
    callerName: call.callerName || otherNumber,
    callerNumber: otherNumber,
    status: isMissed(call.status) ? "missed" : call.status,
    startTime: call.startTime?.toISOString?.() || null,
    duration: formatDuration(call.duration),
    direction: isIncoming ? "incoming" : "outgoing",
    hasRecording: false,
    smsSent: false,
  };
};

/* ================= DB ================= */

export const getUserPhoneNumber = async (uuid) => {
  if (!uuid) return null;
  try {
    const doc = await defaultDB
      .collection(USER_NUMBERS_COLLECTION)
      .doc(uuid)
      .get();
    return doc.exists ? doc.data().phone_number : null;
  } catch (err) {
    console.error(`Failed to get user phone number for ${uuid}:`, err);
    return null;
  }
};

/* ================= CACHE ================= */

const _cache = new Map();
const CACHE_TTL = 300_000; // 5 minutes
const MAX_CACHE_SIZE = 500;

export const cacheGet = (key) => {
  const entry = _cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }

  // Refresh for LRU behavior
  _cache.delete(key);
  _cache.set(key, entry);

  return entry.data;
};

export const cacheSet = (key, data) => {
  if (_cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
  _cache.set(key, { data, ts: Date.now() });
};

export const cacheDelete = (key) => _cache.delete(key);

export const cacheInvalidateByPrefix = (prefix) => {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
};

/* ================= CACHE CLEANUP ================= */

let _cleanupStarted = false;

export const startCacheCleanup = () => {
  if (_cleanupStarted) return;
  _cleanupStarted = true;

  // Changed to 5 minutes to match TTL better
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _cache.entries()) {
      if (now - entry.ts > CACHE_TTL) {
        _cache.delete(key);
      }
    }
  }, 5 * 60 * 1000); // Every 5 minutes
};

/* ================= JWT ================= */

export const verifyJwtToken = (token) => {
  if (!token) return { valid: false, error: "missing" };

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false, error: err.name };
  }
};

/* ================= STREAM ================= */

export const streamRecording = (recordingSid, authHeader, res) => {
  if (!recordingSid) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Recording SID required" }));
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  const req = https.request(
    url,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        ...(authHeader?.range && { Range: authHeader.range }),
      },
      timeout: 10000,
    },
    (twilioRes) => {
      res.writeHead(twilioRes.statusCode || 200, {
        "Content-Type": twilioRes.headers["content-type"] || "audio/mpeg",
        "Accept-Ranges": "bytes",
        ...(twilioRes.headers["content-length"] && {
          "Content-Length": twilioRes.headers["content-length"],
        }),
        ...(twilioRes.headers["content-range"] && {
          "Content-Range": twilioRes.headers["content-range"],
        }),
      });

      twilioRes.pipe(res);
    }
  );

  req.on("timeout", () => req.destroy());
  req.on("error", (err) => {
    console.error("Stream recording error:", err);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Stream failed" }));
    }
  });

  res.on("close", () => {
    req.destroy();
  });

  req.end();
};

/* ================= VALIDATION ================= */

export const isValidE164 = (number) =>
  /^\+[1-9]\d{1,14}$/.test(number);

/* ================= SMS ================= */

const sendWithRetry = async (fn, retry = 2) => {
  for (let i = 0; i <= retry; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retry) throw err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
};

export const sendSMS = async (to, body, from, statusCallback = null) => {
  if (!isValidE164(to) || !isValidE164(from) || !body) {
    throw new Error("Invalid SMS params");
  }

  const client = getTwilioClient();

  return sendWithRetry(() =>
    client.messages.create({
      to,
      from,
      body,
      ...(statusCallback && { statusCallback }),
    })
  );
};

/* ================= MISSED CALL HELPERS ================= */

export const isCallMissed = (status) =>
  ["no-answer", "busy", "canceled", "failed"].includes(status);

// Auto-start cache cleanup
startCacheCleanup();