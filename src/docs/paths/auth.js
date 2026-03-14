const errorSchema = (msg) => ({
  description: msg,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { message: { type: "string" } },
      },
    },
  },
});

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
        200: {
          description: "OTP sent successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  message: { type: "string", example: "OTP sent to your email." },
                },
              },
            },
          },
        },
        400: errorSchema("A valid email is required."),
        500: errorSchema("Failed to send OTP. Please try again."),
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
                  success: { type: "boolean", example: true },
                  token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
                },
              },
            },
          },
        },
        400: {
          description: "Missing fields or invalid/expired OTP",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { message: { type: "string", example: "Email and OTP are required." } },
              },
            },
          },
        },
        500: errorSchema("Failed to verify OTP. Please try again."),
      },
    },
  },
};
