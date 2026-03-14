import { commonSchemas } from "./schema/common.js";
import { healthPaths } from "./paths/health.js";
import { authPaths } from "./paths/auth.js";
import { businessPaths } from "./paths/business.js";
import { profilePaths } from "./paths/profile.js";
import { tokenPaths } from "./paths/voice/token.js";
import { devicePaths } from "./paths/voice/device.js";
import { numbersPaths } from "./paths/voice/numbers.js";
import { forwardingPaths } from "./paths/voice/forwarding.js";
import { callsPaths } from "./paths/voice/calls.js";
import { recordingsPaths } from "./paths/voice/recordings.js";
import { webhooksPaths } from "./paths/voice/webhooks.js";
import { contactPaths } from "./paths/contact.js";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Onliny AI Phone API",
    version: "1.0.0",
    description: "Backend API for Onliny AI Phone application",
  },
  servers: [
    { url: "http://localhost:8080", description: "Local Development" },
    { url: "https://639d-2402-800-6343-d54a-4c07-79f8-b3f7-6cc5.ngrok-free.app", description: "Ngrok Tunnel" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token from /api/auth/verify-otp",
      },
    },
    schemas: commonSchemas,
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Auth", description: "Authentication endpoints" },
    { name: "Business", description: "Business management" },
    { name: "Profile", description: "User profile" },
    { name: "Phone Numbers", description: "Buy and manage phone numbers" },
    { name: "Voice", description: "Voice calls and tokens" },
    { name: "Call Logs", description: "Call history and recordings" },
    { name: "Contacts", description: "Contact management" },
    { name: "Health", description: "Server health check" },
    { name: "Twilio Webhooks", description: "Endpoints called by Twilio — NOT for client use" },
  ],
  paths: {
    ...healthPaths,
    ...authPaths,
    ...businessPaths,
    ...profilePaths,
    ...numbersPaths,

    ...tokenPaths,
    ...devicePaths,
    ...forwardingPaths,
    ...callsPaths,
    ...recordingsPaths,
    ...webhooksPaths,

    ...contactPaths,
  },
};
