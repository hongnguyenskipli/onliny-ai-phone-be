import { FieldValue } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
import { emailTransporter } from "../../../server/index.js";
import {
  OTP_COLLECTION,
  USERS_COLLECTION,
  AWS_SES_VERIFIED_EMAIL,
  OTP_EMAIL_TEMPLATE,
  OTP_EXPIRY_MS,
} from "../../../constants/index.js";

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendOtpService = async ({ email, db = defaultDB }) => {
  const otp = generateOtp();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  await db.collection(OTP_COLLECTION).doc(email).set({
    otp,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  await emailTransporter.sendMail({
    from: AWS_SES_VERIFIED_EMAIL,
    to: email,
    subject: "Your Onliny AI Phone Verification Code",
    html: OTP_EMAIL_TEMPLATE(otp),
  });

  return { success: true };
};

export const verifyOtpService = async ({ email, otp, db = defaultDB }) => {
  const otpDoc = await db.collection(OTP_COLLECTION).doc(email).get();

  if (!otpDoc.exists) {
    return { success: false, message: "OTP not found. Please request a new one." };
  }

  const { otp: storedOtp, expiresAt } = otpDoc.data();

  if (Date.now() > expiresAt) {
    await db.collection(OTP_COLLECTION).doc(email).delete();
    return { success: false, message: "OTP has expired. Please request a new one." };
  }

  if (otp !== storedOtp) {
    return { success: false, message: "Invalid OTP." };
  }

  await db.collection(OTP_COLLECTION).doc(email).delete();

  let userDoc = await db.collection(USERS_COLLECTION).doc(email).get();
  if (!userDoc.exists) {
    await db.collection(USERS_COLLECTION).doc(email).set({
      email,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { success: true, email };
};
