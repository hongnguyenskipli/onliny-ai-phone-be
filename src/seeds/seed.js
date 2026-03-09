import dotenv from "dotenv";
dotenv.config();

import { randomUUID } from "crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const {
  FIREBASE_AUTH_URI,
  FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  FIREBASE_CLIENT_ID,
  FIREBASE_CLIENT_MAIL,
  FIREBASE_CLIENT_X509_CERT_URL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_PRIVATE_KEY_ID,
  FIREBASE_PROJECT_ID,
  FIREBASE_TOKEN_URI,
  FIREBASE_TYPE,
  FIREBASE_UNIVERSE_DOMAIN,
} = process.env;

const serviceAccount = {
  type: FIREBASE_TYPE,
  project_id: FIREBASE_PROJECT_ID,
  private_key_id: FIREBASE_PRIVATE_KEY_ID,
  private_key: FIREBASE_PRIVATE_KEY?.replace(/\\n/gm, "\n"),
  client_email: FIREBASE_CLIENT_MAIL,
  client_id: FIREBASE_CLIENT_ID,
  auth_uri: FIREBASE_AUTH_URI,
  token_uri: FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: FIREBASE_UNIVERSE_DOMAIN,
};

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();

const USER_EMAIL = "harrybother33@gmail.com";
const PHONE_NUMBER = "+14704911422";

const USERS_COLLECTION = "users";
const USER_NUMBERS_COLLECTION = "user_phone_numbers";
const VOICE_BINDINGS_COLLECTION = "voice_bindings";
const BUSINESS_COLLECTION = "businesses";
const CALL_FORWARDING_COLLECTION = "call_forwarding";

async function seed() {
  console.log("Starting seed...");

  let uuid;
  const existingUser = await db.collection(USERS_COLLECTION).doc(USER_EMAIL).get();
  if (existingUser.exists && existingUser.data().uuid) {
    uuid = existingUser.data().uuid;
    console.log(`✓ Existing user found, uuid: ${uuid}`);
  } else {
    uuid = randomUUID();
    console.log(`✓ Generated new uuid: ${uuid}`);
  }

  await db.collection(USERS_COLLECTION).doc(USER_EMAIL).set({
    uuid,
    email: USER_EMAIL,
    name: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`✓ users/${USER_EMAIL}`);

  const numberData = {
    uuid,
    userEmail: USER_EMAIL,
    phone_number: PHONE_NUMBER,
    friendly_name: "(470) 491-1422",
    sid: null,
    region: "GA",
    locality: "Atlanta",
    purchasedAt: new Date().toISOString(),
  };
  await db.collection(USER_NUMBERS_COLLECTION).doc(uuid).set(numberData);
  console.log(`✓ user_phone_numbers/${uuid}`);

  await db.collection(VOICE_BINDINGS_COLLECTION).doc(PHONE_NUMBER).set({
    phoneNumber: PHONE_NUMBER,
    identity: USER_EMAIL,
    uuid,
    updatedAt: new Date().toISOString(),
  });
  console.log(`✓ voice_bindings/${PHONE_NUMBER}`);

  const businessRef = db.collection(BUSINESS_COLLECTION).doc();
  await businessRef.set({
    id: businessRef.id,
    name: "Harry's Business",
    ownerEmail: USER_EMAIL,
    ownerUuid: uuid,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`✓ businesses/${businessRef.id}`);

  await db.collection(CALL_FORWARDING_COLLECTION).doc(uuid).set({
    uuid,
    userEmail: USER_EMAIL,
    enabled: false,
    forwardingNumber: "",
    forwardOnBusy: true,
    forwardOnNoAnswer: true,
    forwardOnUnreachable: false,
    updatedAt: new Date().toISOString(),
  });
  console.log(`✓ call_forwarding/${uuid}`);

  console.log("\nSeed completed successfully.");
  console.log(`  email : ${USER_EMAIL}`);
  console.log(`  uuid  : ${uuid}`);
  console.log(`  phone : ${PHONE_NUMBER}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
