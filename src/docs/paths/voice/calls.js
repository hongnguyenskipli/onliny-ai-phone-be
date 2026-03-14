const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const callsPaths = {
  "/api/voice/calls": {
    get: {
      tags: ["Call Logs"],
      summary: "Get call history",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
        { name: "status", in: "query", schema: { type: "string", enum: ["missed", "completed"] } },
        { name: "search", in: "query", schema: { type: "string" }, description: "Search by caller number or name" },
      ],
      responses: {
        200: {
          description: "Call log list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "array", items: { $ref: "#/components/schemas/CallLog" } },
                  total: { type: "integer" },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch call logs."),
      },
    },
  },

  "/api/voice/calls/stats": {
    get: {
      tags: ["Call Logs"],
      summary: "Get today's call statistics",
      responses: {
        200: {
          description: "Call statistics",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { $ref: "#/components/schemas/CallStats" },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch call stats."),
      },
    },
  },

  "/api/voice/calls/contact/{phoneNumber}": {
    get: {
      tags: ["Call Logs"],
      summary: "Get call thread with a specific contact",
      parameters: [
        { name: "phoneNumber", in: "path", required: true, schema: { type: "string", example: "+15551234567" } },
      ],
      responses: {
        200: {
          description: "Call thread for the contact",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  calls: { type: "array", items: { $ref: "#/components/schemas/CallLog" } },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch contact call thread."),
      },
    },
  },

};
