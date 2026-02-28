import { defaultDB } from "../../../server/db.js";
import { getProfileService, updateProfileService } from "../../Services/Profile/index.js";

const getProfile = async ({ req, res, db = defaultDB }) => {
  try {
    const email = req.user.email;
    const result = await getProfileService({ email, db });
    return res.status(200).json(result);
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({ message: "Failed to fetch profile." });
  }
};

const updateProfile = async ({ req, res, db = defaultDB }) => {
  try {
    const email = req.user.email;
    const { name } = req.body;

    const result = await updateProfileService({ email, name, db });
    return res.status(200).json(result);
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ message: "Failed to update profile." });
  }
};

export default { getProfile, updateProfile };
