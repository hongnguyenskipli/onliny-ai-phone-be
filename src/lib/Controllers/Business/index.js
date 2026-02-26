import { defaultDB } from "../../../server/db.js";
import {
  createBusinessService,
  getBusinessesService,
  deleteBusinessService,
} from "../../Services/Business/index.js";

const createBusiness = async ({ req, res, db = defaultDB }) => {
  try {
    const { name } = req.body;
    const email = req.user.email;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Business name is required." });
    }

    const result = await createBusinessService({ name, email, db });
    return res.status(201).json(result);
  } catch (error) {
    console.error("createBusiness error:", error);
    return res.status(500).json({ message: "Failed to create business." });
  }
};

const getBusinesses = async ({ req, res, db = defaultDB }) => {
  try {
    const email = req.user.email;
    const result = await getBusinessesService({ email, db });
    return res.status(200).json(result);
  } catch (error) {
    console.error("getBusinesses error:", error);
    return res.status(500).json({ message: "Failed to fetch businesses." });
  }
};

const deleteBusiness = async ({ req, res, db = defaultDB }) => {
  try {
    const { id } = req.params;
    const email = req.user.email;

    if (!id) {
      return res.status(400).json({ message: "Business ID is required." });
    }

    const result = await deleteBusinessService({ id, email, db });

    if (!result.success) {
      const status = result.message.startsWith("Forbidden") ? 403 : 404;
      return res.status(status).json({ message: result.message });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("deleteBusiness error:", error);
    return res.status(500).json({ message: "Failed to delete business." });
  }
};

export default { createBusiness, getBusinesses, deleteBusiness };
