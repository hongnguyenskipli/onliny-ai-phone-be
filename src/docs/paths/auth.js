export const authPaths = {
  "/api/auth/send-otp": {
    post: {
      tags: ["Auth"],
      summary: "Send OTP to email",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email"],
              properties: {
                email: { type: "string", format: "email", example: "user@example.com" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "OTP sent successfully" },
        400: { description: "Invalid request" },
      },
    },
  },

  "/api/auth/verify-otp": {
    post: {
      tags: ["Auth"],
      summary: "Verify OTP and get JWT token",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "otp"],
              properties: {
                email: { type: "string", format: "email", example: "user@example.com" },
                otp: { type: "string", example: "123456" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "OTP verified — JWT token returned",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  token: { type: "string" },
                },
              },
            },
          },
        },
        401: { description: "Invalid OTP" },
      },
    },
  },
};
