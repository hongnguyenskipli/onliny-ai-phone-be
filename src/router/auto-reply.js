import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";

const AutoReplyRouter = Router();
const { AutoReplyControllers } = Controllers;

AutoReplyRouter.use(verifyToken);

AutoReplyRouter.get("/", (req, res) => {
  AutoReplyControllers.getAutoReply({ req, res, db: defaultDB });
});

AutoReplyRouter.put("/", (req, res) => {
  AutoReplyControllers.upsertAutoReply({ req, res, db: defaultDB });
});

export default AutoReplyRouter;
