import { Router } from "express";
import Controllers from "../lib/Controllers/index.js";
import { verifyToken } from "../middleware/verifyToken.js";
import { defaultDB } from "../server/db.js";

const BusinessRouter = Router();
const { BusinessControllers } = Controllers;

BusinessRouter.use(verifyToken);

BusinessRouter.post("/", (req, res) => {
  BusinessControllers.createBusiness({ req, res, db: defaultDB });
});

BusinessRouter.get("/", (req, res) => {
  BusinessControllers.getBusinesses({ req, res, db: defaultDB });
});

BusinessRouter.delete("/:id", (req, res) => {
  BusinessControllers.deleteBusiness({ req, res, db: defaultDB });
});

export default BusinessRouter;
