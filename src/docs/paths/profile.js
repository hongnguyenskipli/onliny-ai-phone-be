const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const profilePaths = {
  "/api/profile": {
    get: {
      tags: ["Profile"],
      summary: "Get user profile",
      responses: {
        200: {
          description: "User profile data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  profile: {
                    type: "object",
                    properties: {
                      uuid: { type: "string" },
                      email: { type: "string", format: "email" },
                      name: { type: "string" },
                      company: { type: "string" },
                      phoneNumber: { type: "string", nullable: true },
                      phoneRegion: { type: "string" },
                      phoneLocality: { type: "string" },
                      phoneFriendlyName: { type: "string", nullable: true },
                      createdAt: { type: "string", format: "date-time", nullable: true },
                      updatedAt: { type: "string", format: "date-time", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        401: unauthorized,
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
        200: {
          description: "Profile updated successfully",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Success" },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to update profile."),
      },
    },
  },
};
