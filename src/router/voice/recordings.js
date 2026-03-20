import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { getTwilioClient, streamRecording, verifyJwtToken } from "./shared.js";

const router = Router();

router.get("/calls/:callSid/recordings", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  try {
    const client = getTwilioClient();

    let callDetails;
    try {
      callDetails = await client.calls(callSid).fetch();
    } catch (err) {
      return res.status(404).json({ success: false, message: "Call not found." });
    }

    const directRecordings = await client.calls(callSid).recordings.list().catch(() => []);

    let parentRecordings = [];
    if (callDetails?.parentCallSid) {
      parentRecordings = await client.calls(callDetails.parentCallSid).recordings.list().catch(() => []);
    }

    const seenSids = new Set();
    const allRecordings = [...directRecordings, ...parentRecordings].filter((r) => {
      if (seenSids.has(r.sid)) return false;
      seenSids.add(r.sid);
      return true;
    });

    const mapped = allRecordings
      .filter((r) => (parseInt(r.duration) || 0) > 0)
      .map((r) => ({
        sid: r.sid,
        duration: parseInt(r.duration) || 0,
        dateCreated: r.dateCreated?.toISOString() || null,
        channels: r.channels,
        source: r.source,
      }));

    return res.json({ success: true, recordings: mapped });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch recordings." });
  }
});

router.post("/calls/:callSid/recordings/start", verifyToken, async (req, res) => {
  const { callSid } = req.params;

  try {
    const client = getTwilioClient();

    try {
      await client.calls(callSid).fetch();
    } catch (err) {
      return res.status(404).json({ success: false, message: "Call not found." });
    }

    const recording = await client.calls(callSid).recordings.create({
      recordingChannels: "dual",
    });
    return res.json({ success: true, recordingSid: recording.sid });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to start recording." });
  }
});

router.post("/recordings/:recordingSid/stop", verifyToken, async (req, res) => {
  const { recordingSid } = req.params;

  try {
    const client = getTwilioClient();
    await client.recordings(recordingSid).update({ status: "stopped" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to stop recording." });
  }
});

router.get("/recordings/:recordingSid/stream", async (req, res) => {
  const { token } = req.query;
  const authHeader = req.headers.authorization;

  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const tokenToVerify = token || bearerToken;

  const { valid, error } = verifyJwtToken(tokenToVerify);
  if (!valid) {
    const message = error === "missing" ? "Unauthorized: Missing token." : "Unauthorized: Invalid token.";
    return res.status(401).json({ message });
  }

  streamRecording(req.params.recordingSid, req.headers, res);
});

export default router;
