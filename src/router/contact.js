import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";

const ContactRouter = Router();
const { ContactControllers } = Controllers;

ContactRouter.use(verifyToken);

ContactRouter.get("/", (req, res) => {
  ContactControllers.getContacts({ req, res, db: defaultDB });
});

ContactRouter.post("/", (req, res) => {
  ContactControllers.createContact({ req, res, db: defaultDB });
});

ContactRouter.get("/:id", (req, res) => {
  ContactControllers.getContactById({ req, res, db: defaultDB });
});

ContactRouter.put("/:id", (req, res) => {
  ContactControllers.updateContact({ req, res, db: defaultDB });
});

ContactRouter.delete("/:id", (req, res) => {
  ContactControllers.deleteContact({ req, res, db: defaultDB });
});

export default ContactRouter;
