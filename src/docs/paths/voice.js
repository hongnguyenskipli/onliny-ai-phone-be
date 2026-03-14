const err = (description) => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } },
});

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
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Twilio credentials not configured."),
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
        200: {
          description: "Device bound successfully",
          content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } },
        },
        400: err("phoneNumber is required."),
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Failed to bind device."),
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
          content: { "application/json": { schema: { $ref: "#/components/schemas/ForwardingSettings" } } },
        },
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Failed to fetch forwarding settings."),
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
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Failed to update forwarding settings."),
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
        200: {
          description: "AMD state",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    nullable: true,
                    type: "object",
                    properties: {
                      childCallSid: { type: "string" },
                      humanConnected: { type: "boolean" },
                      timestamp: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        401: err("Unauthorized: Missing or invalid token"),
      },
    },
  },
};
