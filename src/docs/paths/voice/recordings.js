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
      tags: ["Voice/Recordings"],
      summary: "Get recordings for a call",
      description: "Returns a list of call recordings. See https://www.twilio.com/docs/voice/api/recording-resource.",
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
        404: err("Call not found."),
        500: err("Failed to fetch recordings."),
      },
    },
  },

  "/api/voice/calls/{callSid}/recordings/start": {
    post: {
      tags: ["Voice/Recordings"],
      summary: "Start recording an active call",
      description: "Starts a recording for an active call. See https://www.twilio.com/docs/voice/api/recording-resource.",
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
        404: err("Call not found."),
        500: err("Failed to start recording."),
      },
    },
  },

  "/api/voice/recordings/{recordingSid}/stop": {
    post: {
      tags: ["Voice/Recordings"],
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
      tags: ["Voice/Recordings"],
      summary: "Stream a recording audio file (MP3)",
      description: "Requires a JWT token (query or Authorization header). Streams audio from Twilio recording resource.",
      parameters: [
        { name: "recordingSid", in: "path", required: true, schema: { type: "string" } },
        {
          name: "token",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "JWT token from /api/auth/verify-otp (can also be provided via Authorization: Bearer <token>)",
        },
      ],
      responses: {
        200: { description: "Audio stream (audio/mpeg)" },
        401: unauthorized,
        404: err("Recording not found."),
        502: err("Failed to stream recording."),
      },
    },
  },
};
