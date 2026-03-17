const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const numbersPaths = {
  "/api/voice/available-numbers": {
    get: {
      tags: ["Voice/Numbers"],
      summary: "List available phone numbers to purchase",
      description: "Search available Twilio phone numbers. See https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-resource.",
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
        { name: "country", in: "query", schema: { type: "string", default: "US" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      ],
      responses: {
        200: {
          description: "Available numbers with pricing",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "array", items: { $ref: "#/components/schemas/PhoneNumber" } },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch available numbers."),
      },
    },
  },

  "/api/voice/my-number": {
    get: {
      tags: ["Voice/Numbers"],
      summary: "Get the current user's purchased phone number",
      responses: {
        200: {
          description: "User phone number or null if none purchased",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { nullable: true, $ref: "#/components/schemas/PhoneNumber" },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch phone number."),
      },
    },
  },

  "/api/voice/purchase-number": {
    post: {
      tags: ["Voice/Numbers"],
      summary: "Purchase a phone number",
      description: "Purchase a Twilio phone number. See https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-resource.",
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
        200: { description: "Number purchased successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        400: err("phoneNumber is required."),
        401: unauthorized,
        500: err("Failed to purchase phone number."),
      },
    },
  },
};
