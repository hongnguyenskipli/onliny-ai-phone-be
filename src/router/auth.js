import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { defaultDB } from "../server/db.js";
import { verifyToken } from "../middleware/verifyToken.js";

const AuthRouter = Router();
const { AuthControllers } = Controllers;

AuthRouter.post("/send-otp", (req, res) => {
  AuthControllers.sendOtp({ req, res, db: defaultDB });
});

AuthRouter.post("/verify-otp", (req, res) => {
  AuthControllers.verifyOtp({ req, res, db: defaultDB });
});

// Lightweight endpoint to validate token without fetching business/phone data
AuthRouter.get("/me", verifyToken, (req, res) => {
  res.json({ success: true, uuid: req.user.uuid, email: req.user.email });
});

export default AuthRouter;
