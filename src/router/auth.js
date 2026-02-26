import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { defaultDB } from "../server/db.js";

const AuthRouter = Router();
const { AuthControllers } = Controllers;

AuthRouter.post("/send-otp", (req, res) => {
  AuthControllers.sendOtp({ req, res, db: defaultDB });
});

AuthRouter.post("/verify-otp", (req, res) => {
  AuthControllers.verifyOtp({ req, res, db: defaultDB });
});

export default AuthRouter;
