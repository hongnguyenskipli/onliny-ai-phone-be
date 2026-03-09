import { FieldValue } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
import { USERS_COLLECTION, BUSINESS_COLLECTION, USER_NUMBERS_COLLECTION } from "../../../constants/index.js";

export const getProfileService = async ({ email, uuid, db = defaultDB }) => {
  const [userDoc, businessSnapshot, phoneDoc] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(email).get(),
    db.collection(BUSINESS_COLLECTION).where("ownerEmail", "==", email).limit(1).get(),
    uuid ? db.collection(USER_NUMBERS_COLLECTION).doc(uuid).get() : Promise.resolve({ exists: false }),
  ]);

  const userData = userDoc.exists ? userDoc.data() : {};
  const business = businessSnapshot.empty ? null : businessSnapshot.docs[0].data();
  const phoneData = phoneDoc.exists ? phoneDoc.data() : null;

  return {
    success: true,
    profile: {
      uuid: userData.uuid || uuid,
      email,
      name: userData.name ?? "",
      company: business?.name ?? "",
      phoneNumber: phoneData?.phone_number ?? null,
      phoneRegion: phoneData?.region ?? "",
      phoneLocality: phoneData?.locality ?? "",
      phoneFriendlyName: phoneData?.friendly_name ?? null,
      createdAt: userData.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: userData.updatedAt?.toDate?.()?.toISOString() ?? null,
    },
  };
};

export const updateProfileService = async ({ email, name, db = defaultDB }) => {
  await db.collection(USERS_COLLECTION).doc(email).set(
    {
      name: name?.trim() ?? "",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true };
};
