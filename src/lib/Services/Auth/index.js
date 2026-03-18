import { randomUUID } from "crypto";
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

  try {
    await Promise.race([
      emailTransporter.sendMail({
        from: AWS_SES_VERIFIED_EMAIL,
        to: email,
        subject: "Your Onliny AI Phone Verification Code",
        html: OTP_EMAIL_TEMPLATE(otp),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout sending email to SES")), 3000))
    ]);
  } catch (err) {
    console.log("Email sending failed or timed out:", err.message);
  }


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
  let uuid;

  if (!userDoc.exists) {
    uuid = randomUUID();
    await db.collection(USERS_COLLECTION).doc(email).set({
      uuid,
      email,
      name: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const data = userDoc.data();
    if (!data.uuid) {
      uuid = randomUUID();
      await db.collection(USERS_COLLECTION).doc(email).set(
        { uuid, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    } else {
      uuid = data.uuid;
    }
  }

  return { success: true, uuid, email };
};
