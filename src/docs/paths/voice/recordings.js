const err = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const unauthorized = {
  description: "Unauthorized - missing/invalid/expired token. See the message for details.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/UnauthorizedError" } } },
};

export const recordingsPaths = {
  "/api/voice/calls/{callSid}/recordings": {
    get: {
      tags: ["Call Logs"],
      summary: "Get recordings for a call",
      parameters: [
        { name: "callSid", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "List of recordings",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  recordings: { type: "array", items: { $ref: "#/components/schemas/Recording" } },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to fetch recordings."),
      },
    },
  },

  "/api/voice/calls/{callSid}/recordings/start": {
    post: {
      tags: ["Call Logs"],
      summary: "Start recording an active call",
      parameters: [
        { name: "callSid", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "Recording started",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  recordingSid: { type: "string" },
                },
              },
            },
          },
        },
        401: unauthorized,
        500: err("Failed to start recording."),
      },
    },
  },

  "/api/voice/recordings/{recordingSid}/stop": {
    post: {
      tags: ["Call Logs"],
      summary: "Stop an active recording",
      parameters: [
        { name: "recordingSid", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "Recording stopped",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
        },
        401: unauthorized,
        500: err("Failed to stop recording."),
      },
    },
  },

  "/api/voice/recordings/{recordingSid}/stream": {
    get: {
      tags: ["Call Logs"],
      summary: "Stream a recording audio file (MP3)",
      parameters: [
        { name: "recordingSid", in: "path", required: true, schema: { type: "string" } },
        {
          name: "token",
          in: "query",
          schema: { type: "string" },
          description: "JWT token (alternative to Authorization header)",
        },
      ],
      responses: {
        200: { description: "Audio stream (audio/mpeg)" },
        401: unauthorized,
        502: err("Failed to stream recording."),
      },
    },
  },
};
