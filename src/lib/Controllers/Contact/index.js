import {
  createContactService,
  getContactsService,
  getContactByIdService,
  updateContactService,
  deleteContactService,
} from "../../Services/Contact/index.js";

const createContact = async ({ req, res, db }) => {
  try {
    const { uuid } = req.user;
    const { name, phoneNumber, email, company, notes, avatarColor } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }
    if (!phoneNumber?.trim()) {
      return res.status(400).json({ success: false, message: "Phone number is required." });
    }

    const result = await createContactService({ ownerUuid: uuid, name, phoneNumber, email, company, notes, avatarColor, db });
    return res.status(201).json(result);
  } catch (error) {
    console.error("createContact error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

const getContacts = async ({ req, res, db }) => {
  try {
    const { uuid } = req.user;
    const { search } = req.query;
    const result = await getContactsService({ ownerUuid: uuid, search, db });
    return res.status(200).json(result);
  } catch (error) {
    console.error("getContacts error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

const getContactById = async ({ req, res, db }) => {
  try {
    const { uuid } = req.user;
    const { id } = req.params;
    const result = await getContactByIdService({ id, ownerUuid: uuid, db });
    if (!result.success) {
      return res.status(result.message === "Forbidden." ? 403 : 404).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error("getContactById error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

const updateContact = async ({ req, res, db }) => {
  try {
    const { uuid } = req.user;
    const { id } = req.params;
    const { name, phoneNumber, email, company, notes, avatarColor } = req.body;

    const result = await updateContactService({ id, ownerUuid: uuid, name, phoneNumber, email, company, notes, avatarColor, db });
    if (!result.success) {
      return res.status(result.message === "Forbidden." ? 403 : 404).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error("updateContact error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

const deleteContact = async ({ req, res, db }) => {
  try {
    const { uuid } = req.user;
    const { id } = req.params;
    const result = await deleteContactService({ id, ownerUuid: uuid, db });
    if (!result.success) {
      return res.status(result.message === "Forbidden." ? 403 : 404).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error("deleteContact error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

export default { createContact, getContacts, getContactById, updateContact, deleteContact };
