export const contactPaths = {
  "/api/contacts": {
    get: {
      tags: ["Contacts"],
      summary: "Get all contacts",
      responses: {
        200: {
          description: "List of contacts",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    },
    post: {
      tags: ["Contacts"],
      summary: "Create a new contact",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "phone"],
              properties: {
                name: { type: "string", example: "John Doe" },
                phone: { type: "string", example: "+15551234567" },
                email: { type: "string", format: "email", example: "john@example.com" },
                notes: { type: "string", example: "VIP client" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Contact created" },
        401: { description: "Unauthorized" },
      },
    },
  },

  "/api/contacts/{id}": {
    get: {
      tags: ["Contacts"],
      summary: "Get a contact by ID",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "Contact data",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Contact" },
            },
          },
        },
        401: { description: "Unauthorized" },
        404: { description: "Contact not found" },
      },
    },
    put: {
      tags: ["Contacts"],
      summary: "Update a contact",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string", format: "email" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Contact updated" },
        401: { description: "Unauthorized" },
      },
    },
    delete: {
      tags: ["Contacts"],
      summary: "Delete a contact",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Contact deleted" },
        401: { description: "Unauthorized" },
      },
    },
  },
};
