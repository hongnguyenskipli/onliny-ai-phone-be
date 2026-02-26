import dotenv from "dotenv";
dotenv.config();

export { AWS_CONFIG_ROOT, AWS_SES_VERIFIED_EMAIL } from "./aws.js";
export { OTP_EMAIL_TEMPLATE } from "./email-templates.js";
export { USERS_COLLECTION, OTP_COLLECTION, BUSINESS_COLLECTION } from "./collections-db-paths.js";

export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:8080", "http://localhost:8081"];

export const OTP_EXPIRY_MS = 10 * 60 * 1000;
