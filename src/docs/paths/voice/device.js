const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const devicePaths = {
  "/api/voice/calls/{callSid}/amd-state": {
    get: {
      tags: ["Voice/Device"],
      summary: "Get AMD (answering machine detection) state for a call",
      description: "Returns AMD state tracked from Twilio Status Callbacks. See https://www.twilio.com/docs/voice/api/call-resource#statuscallbacks.",
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
                  success: { type: "boolean", example: true },
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
        401: unauthorized,
      },
    },
  },

  "/api/voice/bind": {
    post: {
      tags: ["Voice/Device"],
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
        200: { description: "Device bound successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        400: err("phoneNumber is required."),
        401: unauthorized,
        500: err("Failed to bind device."),
      },
    },
  },
};
