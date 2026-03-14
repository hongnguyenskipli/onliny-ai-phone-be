const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const tokenPaths = {
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
        401: unauthorized,
        500: err("Twilio credentials not configured."),
      },
    },
  },
};
