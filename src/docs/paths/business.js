export const businessPaths = {
  "/api/business": {
    get: {
      tags: ["Business"],
      summary: "Get all businesses",
      responses: {
        200: { description: "List of businesses" },
        401: { description: "Unauthorized" },
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
        200: { description: "Business created" },
        401: { description: "Unauthorized" },
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
        200: { description: "Business deleted" },
        401: { description: "Unauthorized" },
      },
    },
  },
};
