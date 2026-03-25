import { defaultDB } from "../../../server/db.js";
import {
  getAutoReplyService,
  upsertAutoReplyService,
} from "../../Services/AutoReply/index.js";

const getAutoReply = async ({ req, res, db = defaultDB }) => {
  try {
    const { uuid } = req.user;
    const result = await getAutoReplyService({ uuid, db });
    return res.status(200).json(result);
  } catch (error) {
    console.error("getAutoReply error:", error);
    return res.status(500).json({ message: "Failed to fetch auto-reply settings." });
  }
};

const upsertAutoReply = async ({ req, res, db = defaultDB }) => {
  try {
    const { uuid } = req.user;
    const { missedCallMessage, enabled } = req.body;

    const result = await upsertAutoReplyService({
      uuid,
      missedCallMessage,
      enabled,
      db,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("upsertAutoReply error:", error);
    return res.status(500).json({ message: "Failed to update auto-reply settings." });
  }
};

export default { getAutoReply, upsertAutoReply };
