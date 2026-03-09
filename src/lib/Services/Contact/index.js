import { FieldValue } from "firebase-admin/firestore";
import { defaultDB } from "../../../server/db.js";
import { CONTACTS_COLLECTION } from "../../../constants/index.js";

export const createContactService = async ({ ownerUuid, name, phoneNumber, email, company, notes, avatarColor, db = defaultDB }) => {
  const docRef = db.collection(CONTACTS_COLLECTION).doc();
  const contact = {
    id: docRef.id,
    ownerUuid,
    name: name.trim(),
    phoneNumber: phoneNumber.trim(),
    email: email?.trim() || "",
    company: company?.trim() || "",
    notes: notes?.trim() || "",
    avatarColor: avatarColor || "#2B7FFF",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await docRef.set(contact);
  return {
    success: true,
    contact: { ...contact, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
};

export const getContactsService = async ({ ownerUuid, search, db = defaultDB }) => {
  let query = db.collection(CONTACTS_COLLECTION).where("ownerUuid", "==", ownerUuid);

  const snapshot = await query.get();

  let contacts = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  if (search) {
    const q = search.toLowerCase();
    contacts = contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phoneNumber?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
    );
  }

  contacts.sort((a, b) => a.name.localeCompare(b.name));

  return { success: true, contacts };
};

export const getContactByIdService = async ({ id, ownerUuid, db = defaultDB }) => {
  const doc = await db.collection(CONTACTS_COLLECTION).doc(id).get();

  if (!doc.exists) {
    return { success: false, message: "Contact not found." };
  }

  const data = doc.data();
  if (data.ownerUuid !== ownerUuid) {
    return { success: false, message: "Forbidden." };
  }

  return {
    success: true,
    contact: {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    },
  };
};

export const updateContactService = async ({ id, ownerUuid, name, phoneNumber, email, company, notes, avatarColor, db = defaultDB }) => {
  const docRef = db.collection(CONTACTS_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { success: false, message: "Contact not found." };
  }

  if (doc.data().ownerUuid !== ownerUuid) {
    return { success: false, message: "Forbidden." };
  }

  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (name !== undefined) updates.name = name.trim();
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber.trim();
  if (email !== undefined) updates.email = email.trim();
  if (company !== undefined) updates.company = company.trim();
  if (notes !== undefined) updates.notes = notes.trim();
  if (avatarColor !== undefined) updates.avatarColor = avatarColor;

  await docRef.update(updates);

  const updated = await docRef.get();
  const data = updated.data();
  return {
    success: true,
    contact: {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    },
  };
};

export const deleteContactService = async ({ id, ownerUuid, db = defaultDB }) => {
  const docRef = db.collection(CONTACTS_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { success: false, message: "Contact not found." };
  }

  if (doc.data().ownerUuid !== ownerUuid) {
    return { success: false, message: "Forbidden." };
  }

  await docRef.delete();
  return { success: true };
};
