export const voicePaths = {
  "/api/voice/token": {
    get: {
      tags: ["Voice"],
      summary: "Get Twilio access token for voice calls",
      responses: {
        200: {
          description: "Access token",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  token: { type: "string" },
                  identity: { type: "string" },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized" },
        500: { description: "Twilio credentials not configured" },
      },
    },
  },

  "/api/voice/bind": {
    post: {
      tags: ["Voice"],
      summary: "Bind a phone number to the current user device",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["phoneNumber"],
              properties: {
                phoneNumber: { type: "string", example: "+15551234567" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Device bound successfully" },
        400: { description: "phoneNumber is required" },
        401: { description: "Unauthorized" },
      },
    },
  },

  "/api/voice/forwarding": {
    get: {
      tags: ["Voice"],
      summary: "Get call forwarding settings",
      responses: {
        200: {
          description: "Forwarding settings",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ForwardingSettings" },
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    },
    put: {
      tags: ["Voice"],
      summary: "Update call forwarding settings",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ForwardingSettings" },
          },
        },
      },
      responses: {
        200: { description: "Forwarding settings updated" },
        401: { description: "Unauthorized" },
      },
    },
  },

  "/api/voice/calls/{callSid}/amd-state": {
    get: {
      tags: ["Voice"],
      summary: "Get AMD (answering machine detection) state for a call",
      parameters: [
        { name: "callSid", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: { description: "AMD state" },
        401: { description: "Unauthorized" },
      },
    },
  },
};
