/**
 * test-twilio.js
 * Run: node test-twilio.js
 *
 * Kiểm tra kết nối Twilio và liệt kê thông tin cần thiết để cấu hình.
 */

import dotenv from "dotenv";
dotenv.config();

import twilio from "twilio";

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  TWILIO_APP_SID,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_CLIENT_IDENTITY,
} = process.env;

const REQUIRED = {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  TWILIO_APP_SID,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_CLIENT_IDENTITY,
};

console.log("\n==============================");
console.log("  🔍 Twilio Config Checker");
console.log("==============================\n");

let allSet = true;
for (const [key, val] of Object.entries(REQUIRED)) {
  const missing = !val || val.startsWith("your_");
  if (missing) allSet = false;
  const icon = missing ? "❌" : "✅";
  const display = missing ? "(NOT SET)" : val.startsWith("AC") || val.startsWith("SK") || val.startsWith("AP") ? val : "***hidden***";
  console.log(`${icon}  ${key.padEnd(28)} ${display}`);
}

console.log("");

if (!TWILIO_ACCOUNT_SID || TWILIO_ACCOUNT_SID.startsWith("your_") ||
    !TWILIO_AUTH_TOKEN  || TWILIO_AUTH_TOKEN.startsWith("your_")) {
  console.log("⛔  Cannot connect — TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing.\n");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

console.log("📡 Connecting to Twilio API...\n");

try {
  // 1. Verify account
  const account = await client.api.accounts(TWILIO_ACCOUNT_SID).fetch();
  console.log(`✅  Account Name   : ${account.friendlyName}`);
  console.log(`✅  Account Status : ${account.status}`);
  console.log("");

  // 2. Check the purchased phone number
  if (TWILIO_PHONE_NUMBER) {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: TWILIO_PHONE_NUMBER });
    if (numbers.length > 0) {
      const num = numbers[0];
      console.log(`✅  Phone Number   : ${num.phoneNumber} (${num.friendlyName})`);
      console.log(`    Voice URL      : ${num.voiceUrl || "(not set)"}`);
      console.log(`    SMS URL        : ${num.smsUrl || "(not set)"}`);
      if (!num.voiceUrl) {
        console.log("⚠️   Voice URL is empty — incoming calls won't work until you set it.");
        console.log(`    → Set it to: https://<your-ngrok-url>/api/voice/incoming`);
      }
    } else {
      console.log(`⚠️   Phone Number ${TWILIO_PHONE_NUMBER} not found in your account.`);
    }
    console.log("");
  }

  // 3. Check TwiML App
  if (TWILIO_APP_SID && !TWILIO_APP_SID.startsWith("your_")) {
    try {
      const app = await client.applications(TWILIO_APP_SID).fetch();
      console.log(`✅  TwiML App      : ${app.friendlyName} (${app.sid})`);
      console.log(`    Voice Request  : ${app.voiceUrl || "(not set)"}`);
    } catch {
      console.log(`❌  TwiML App SID ${TWILIO_APP_SID} not found.`);
    }
    console.log("");
  } else {
    console.log("⚠️   TWILIO_APP_SID not set — create a TwiML App in Twilio Console.\n");
  }

  console.log("==============================");
  if (allSet) {
    console.log("🎉  All variables set! Backend should work.\n");
  } else {
    console.log("⚠️   Some variables are missing. See TESTING_GUIDE.md\n");
  }
} catch (err) {
  console.error("❌  Twilio connection failed:", err.message, "\n");
  process.exit(1);
}
