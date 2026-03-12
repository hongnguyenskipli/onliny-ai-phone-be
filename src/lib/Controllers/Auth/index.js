import jwt from "jsonwebtoken";
import { sendOtpService, verifyOtpService } from "../../Services/Auth/index.js";
import { defaultDB } from "../../../server/db.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//send otp to email and save in db with expiry time of 5 minutes
const sendOtp = async ({ req, res, db = defaultDB }) => {
  try {
    const { email } = req.body;

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "A valid email is required." });
    }

    await sendOtpService({ email: email.toLowerCase().trim(), db });

    return res.status(200).json({ success: true, message: "OTP sent to your email." });
  } catch (error) {
    console.error("sendOtp error:", error);
    return res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
};

const verifyOtp = async ({ req, res, db = defaultDB }) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const result = await verifyOtpService({ email: email.toLowerCase().trim(), otp: String(otp), db });

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    const token = jwt.sign(
      { uuid: result.uuid, email: result.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.status(200).json({ success: true, token });
  } catch (error) {
    console.error("verifyOtp error:", error);
    return res.status(500).json({ message: "Failed to verify OTP. Please try again." });
  }
};

export default { sendOtp, verifyOtp };
