import dotenv from "dotenv";
dotenv.config();

export const AWS_SES_VERIFIED_EMAIL = process.env.AWS_VERIFIED_EMAIL;

export const AWS_CONFIG_ROOT = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
};
