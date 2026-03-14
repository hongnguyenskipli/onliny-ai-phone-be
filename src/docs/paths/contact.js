const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const contactPaths = {
  "/api/contacts": {
    get: {
      tags: ["Contacts"],
      summary: "Get all contacts",
      parameters: [
        { name: "search", in: "query", schema: { type: "string" }, description: "Search by name or phone" },
      ],
      responses: {
        200: {
          description: "List of contacts",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Internal server error."),
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
              required: ["name", "phoneNumber"],
              properties: {
                name: { type: "string", example: "John Doe" },
                phoneNumber: { type: "string", example: "+15551234567" },
                email: { type: "string", format: "email", example: "john@example.com" },
                company: { type: "string", example: "Acme Corp" },
                notes: { type: "string", example: "VIP client" },
                avatarColor: { type: "string", example: "#FF5733" },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Contact created successfully",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
        },
        400: err("Name is required. / Phone number is required."),
        401: unauthorized,
        500: err("Internal server error."),
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
          content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } },
        },
        401: unauthorized,
        403: err("Forbidden."),
        404: err("Contact not found."),
        500: err("Internal server error."),
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
                phoneNumber: { type: "string" },
                email: { type: "string", format: "email" },
                company: { type: "string" },
                notes: { type: "string" },
                avatarColor: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Contact updated successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        401: unauthorized,
        403: err("Forbidden."),
        404: err("Contact not found."),
        500: err("Internal server error."),
      },
    },
    delete: {
      tags: ["Contacts"],
      summary: "Delete a contact",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Contact deleted successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        401: unauthorized,
        403: err("Forbidden."),
        404: err("Contact not found."),
        500: err("Internal server error."),
      },
    },
  },
};
