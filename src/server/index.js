import cors from "cors";
import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import aws from "aws-sdk";
import nodemailer from "nodemailer";
import { apiReference } from "@scalar/express-api-reference";

import { ALLOWED_ORIGINS, AWS_CONFIG_ROOT } from "../constants/index.js";
import AuthRouter from "../router/auth.js";
import BusinessRouter from "../router/business.js";
import ProfileRouter from "../router/profile.js";
import VoiceRouter from "../router/voice.js";
import ContactRouter from "../router/contact.js";
import AutoReplyRouter from "../router/auto-reply.js";
import { defaultDB } from "./db.js";
import { openApiSpec } from "../docs/openapi.js";

dotenv.config();

export const emailTransporter = nodemailer.createTransport({
  SES: new aws.SES({ ...AWS_CONFIG_ROOT, apiVersion: "2010-12-01" }),
});

const app = express();

app.disable("x-powered-by");

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
  if (!defaultDB) return res.status(503).json({ status: "error", message: "Cannot connect to the database" });
  res.status(200).json({ status: "ok" });
});

app.get("/api/openapi.json", (req, res) => res.json(openApiSpec));

app.use(
  "/api/docs",
  apiReference({
    spec: { content: openApiSpec },
    theme: "purple",
  })
);

app.use("/api/auth", AuthRouter);
app.use("/api/business", BusinessRouter);
app.use("/api/profile", ProfileRouter);
app.use("/api/voice", VoiceRouter);
app.use("/api/contacts", ContactRouter);
app.use("/api/auto-reply", AutoReplyRouter);

app.use((req, res) => {
  res.status(404).json({ status: 404, message: "Not Found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    status: err.status || 500,
    message: err.message,
  });
});

export default app;
