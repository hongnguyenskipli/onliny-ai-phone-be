const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const businessPaths = {
  "/api/business": {
    get: {
      tags: ["Business"],
      summary: "Get all businesses",
      responses: {
        200: {
          description: "List of businesses",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  businesses: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Business" },
                  },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch businesses."),
      },
    },
    post: {
      tags: ["Business"],
      summary: "Create a business",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", example: "My Business" },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Business created successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  business: { $ref: "#/components/schemas/Business" },
                },
              },
            },
          },
        },
        400: err("Business name is required."),
        401: unauthorized,
        500: err("Failed to create business."),
      },
    },
  },

  "/api/business/{id}": {
    delete: {
      tags: ["Business"],
      summary: "Delete a business",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "Business deleted",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
        },
        400: err("Business ID is required."),
        401: unauthorized,
        403: err("Forbidden: You do not own this business"),
        404: err("Business not found"),
        500: err("Failed to delete business."),
      },
    },
  },
};
