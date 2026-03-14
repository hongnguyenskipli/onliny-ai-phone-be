const err = (description) => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } },
});

export const businessPaths = {
  "/api/business": {
    get: {
      tags: ["Business"],
      summary: "Get all businesses",
      responses: {
        200: { description: "List of businesses" },
        401: err("Unauthorized: Missing or invalid token"),
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
        201: { description: "Business created successfully" },
        400: err("Business name is required."),
        401: err("Unauthorized: Missing or invalid token"),
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
          content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } },
        },
        400: err("Business ID is required."),
        401: err("Unauthorized: Missing or invalid token"),
        403: err("Forbidden: You do not own this business"),
        404: err("Business not found"),
        500: err("Failed to delete business."),
      },
    },
  },
};
