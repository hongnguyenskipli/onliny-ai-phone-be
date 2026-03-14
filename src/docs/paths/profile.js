const err = (description) => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } },
});

export const profilePaths = {
  "/api/profile": {
    get: {
      tags: ["Profile"],
      summary: "Get user profile",
      responses: {
        200: { description: "User profile data" },
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Failed to fetch profile."),
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
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Profile updated successfully" },
        401: err("Unauthorized: Missing or invalid token"),
        500: err("Failed to update profile."),
      },
    },
  },
};
