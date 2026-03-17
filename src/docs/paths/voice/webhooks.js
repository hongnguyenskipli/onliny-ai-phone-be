const twimlResponse = {
  description: "TwiML XML response (handled by Twilio)",
  content: { "text/xml": { schema: { type: "string", example: "<Response><Dial>...</Dial></Response>" } } },
};

const noContent = { description: "No content — Twilio does not require a body" };

export const webhooksPaths = {
  "/api/voice/incoming": {
    post: {
      tags: ["Voice/Webhooks"],
      summary: "Incoming call webhook (called by Twilio)",
      description: "Twilio calls this endpoint when someone dials your purchased number. Returns TwiML to route the call to the registered client. See https://www.twilio.com/docs/voice/twiml/dial.",
      security: [],
      requestBody: {
        description: "Twilio sends form-encoded data",
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              properties: {
                To: { type: "string", example: "+15551234567" },
                From: { type: "string", example: "+15559876543" },
                CallSid: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: twimlResponse,
      },
    },
  },

  "/api/voice/outgoing": {
    post: {
      tags: ["Voice/Webhooks"],
      summary: "Outgoing call webhook (called by Twilio TwiML App)",
      description: "Twilio calls this endpoint to get TwiML instructions for outgoing calls placed via the SDK. See https://www.twilio.com/docs/voice/twiml.",
      security: [],
      requestBody: {
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              properties: {
                To: { type: "string", example: "+15559876543" },
                Caller: { type: "string", example: "client:user@example.com" },
                CallSid: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: twimlResponse,
      },
    },
  },

  "/api/voice/recording-status": {
    post: {
      tags: ["Voice/Webhooks"],
      summary: "Recording status callback (called by Twilio)",
      description: "Twilio calls this after a call recording is completed. See https://www.twilio.com/docs/voice/api/call-resource#statuscallbacks.",
      security: [],
      responses: { 204: noContent },
    },
  },

  "/api/voice/call-answered": {
    post: {
      tags: ["Voice/Webhooks"],
      summary: "Call answered status callback (called by Twilio)",
      description: "Twilio calls this when the outgoing call is answered. Used for AMD (answering machine detection) tracking. See https://www.twilio.com/docs/voice/api/call-resource#statuscallbacks.",
      security: [],
      parameters: [
        { name: "parentSid", in: "query", schema: { type: "string" }, description: "Parent call SID" },
      ],
      requestBody: {
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              properties: {
                CallStatus: { type: "string", example: "in-progress" },
                CallSid: { type: "string" },
              },
            },
          },
        },
      },
      responses: { 204: noContent },
    },
  },

  "/api/voice/amd-status": {
    post: {
      tags: ["Voice/Webhooks"],
      summary: "AMD status callback (called by Twilio)",
      description: "Twilio calls this with answering machine detection results. See https://www.twilio.com/docs/voice/api/call-resource#statuscallbacks.",
      security: [],
      responses: { 204: noContent },
    },
  },
};
