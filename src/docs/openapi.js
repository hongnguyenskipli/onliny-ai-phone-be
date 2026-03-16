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
    { name: "Contacts", description: "Contact management" },
    { name: "Health", description: "Server health check" },
    { name: "Voice/Numbers", description: "Purchase and manage Twilio phone numbers" },
    { name: "Voice/Token", description: "Generate Twilio access tokens for voice" },
    { name: "Voice/Device", description: "Bind a device and retrieve AMD state" },
    { name: "Voice/Forwarding", description: "Call forwarding settings" },
    { name: "Voice/Calls", description: "Call history and filtering" },
    { name: "Voice/Recordings", description: "Call recording management" },
    { name: "Voice/Webhooks", description: "Endpoints called by Twilio (not for client use)" },
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
