const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const forwardingPaths = {
  "/api/voice/forwarding": {
    get: {
      tags: ["Voice/Forwarding"],
      summary: "Get call forwarding settings",
      responses: {
        200: {
          description: "Forwarding settings",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ForwardingSettings" } } },
        },
        401: unauthorized,
        500: err("Failed to fetch forwarding settings."),
      },
    },
    put: {
      tags: ["Voice/Forwarding"],
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
        200: { description: "Forwarding settings updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        401: unauthorized,
        500: err("Failed to update forwarding settings."),
      },
    },
  },
};
