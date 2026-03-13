export const phoneNumberPaths = {
  "/api/voice/available-numbers": {
    get: {
      tags: ["Phone Numbers"],
      summary: "List available phone numbers to purchase",
      parameters: [
        {
          name: "type",
          in: "query",
          schema: { type: "string", enum: ["Local", "TollFree"], default: "Local" },
          description: "Number type",
        },
        {
          name: "areaCode",
          in: "query",
          schema: { type: "string", example: "415" },
          description: "Filter by area code (Local only)",
        },
        {
          name: "country",
          in: "query",
          schema: { type: "string", default: "US" },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
        },
      ],
      responses: {
        200: {
          description: "Available numbers with pricing",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PhoneNumber" },
                  },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    },
  },

  "/api/voice/my-number": {
    get: {
      tags: ["Phone Numbers"],
      summary: "Get the current user's purchased phone number",
      responses: {
        200: {
          description: "User phone number data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: { $ref: "#/components/schemas/PhoneNumber" },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    },
  },

  "/api/voice/purchase-number": {
    post: {
      tags: ["Phone Numbers"],
      summary: "Purchase a phone number",
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
        200: { description: "Number purchased successfully" },
        400: { description: "phoneNumber is required" },
        401: { description: "Unauthorized" },
      },
    },
  },
};
