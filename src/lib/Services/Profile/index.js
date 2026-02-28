import { FieldValue } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
import { USERS_COLLECTION, BUSINESS_COLLECTION } from "../../../constants/index.js";

export const getProfileService = async ({ email, db = defaultDB }) => {
  const [userDoc, businessSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(email).get(),
    db.collection(BUSINESS_COLLECTION).where("ownerEmail", "==", email).limit(1).get(),
  ]);

  const userData = userDoc.exists ? userDoc.data() : {};
  const business = businessSnapshot.empty ? null : businessSnapshot.docs[0].data();

  return {
    success: true,
    profile: {
      email,
      name: userData.name ?? "",
      company: business?.name ?? "",
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
