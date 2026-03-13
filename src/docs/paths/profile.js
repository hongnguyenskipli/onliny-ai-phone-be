export const profilePaths = {
  "/api/profile": {
    get: {
      tags: ["Profile"],
      summary: "Get user profile",
      responses: {
        200: { description: "User profile data" },
        401: { description: "Unauthorized" },
      },
    },
    put: {
      tags: ["Profile"],
      summary: "Update user profile",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", example: "John Doe" },
                phone: { type: "string", example: "+15551234567" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Profile updated" },
        401: { description: "Unauthorized" },
      },
    },
  },
};
