import { FieldValue } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
import { BUSINESS_COLLECTION } from "../../../constants/index.js";

export const createBusinessService = async ({ name, email, uuid, db = defaultDB }) => {
  const docRef = db.collection(BUSINESS_COLLECTION).doc();
  const business = {
    id: docRef.id,
    name: name.trim(),
    ownerEmail: email,
    ownerUuid: uuid,
    createdAt: FieldValue.serverTimestamp(),
  };

  await docRef.set(business);
  return { success: true, business: { ...business, createdAt: new Date().toISOString() } };
};

export const getBusinessesService = async ({ email, db = defaultDB }) => {
  const snapshot = await db
    .collection(BUSINESS_COLLECTION)
    .where("ownerEmail", "==", email)
    .get();

  const businesses = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return { success: true, businesses };
};

export const deleteBusinessService = async ({ id, email, db = defaultDB }) => {
  const docRef = db.collection(BUSINESS_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { success: false, message: "Business not found." };
  }

  if (doc.data().ownerEmail !== email) {
    return { success: false, message: "Forbidden: You do not own this business." };
  }

  await docRef.delete();
  return { success: true };
};
