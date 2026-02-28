import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";

const ProfileRouter = Router();
const { ProfileControllers } = Controllers;

ProfileRouter.use(verifyToken);

ProfileRouter.get("/", (req, res) => {
  ProfileControllers.getProfile({ req, res, db: defaultDB });
});

ProfileRouter.put("/", (req, res) => {
  ProfileControllers.updateProfile({ req, res, db: defaultDB });
});

export default ProfileRouter;
