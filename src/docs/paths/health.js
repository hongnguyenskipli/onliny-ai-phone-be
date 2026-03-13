export const healthPaths = {
  "/health": {
    get: {
      tags: ["Health"],
      summary: "Health check",
      security: [],
      responses: {
        200: {
          description: "Server is healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { status: { type: "string", example: "ok" } },
              },
            },
          },
        },
        503: { description: "Database unavailable" },
      },
    },
  },
};
