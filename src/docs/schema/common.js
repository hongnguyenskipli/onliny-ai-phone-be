export const commonSchemas = {
  Error: {
    type: "object",
    properties: {
      message: { type: "string", example: "An error occurred." },
    },
  },
  UnauthorizedError: {
    type: "object",
    properties: {
      message: {
        type: "string",
        enum: [
          "Unauthorized: Missing token.",
          "Unauthorized: Invalid token payload.",
          "Unauthorized: Token has expired.",
          "Unauthorized: Invalid token.",
        ],
        example: "Unauthorized: Missing token.",
      },
    },
  },
  Success: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
    },
  },
  PhoneNumber: {
    type: "object",
    properties: {
      phone_number: { type: "string", example: "+15551234567" },
      friendly_name: { type: "string", example: "(555) 123-4567" },
      region: { type: "string", example: "CA" },
      locality: { type: "string", example: "San Francisco" },
      iso_country: { type: "string", example: "US" },
      price: {
        nullable: true,
        type: "object",
        properties: {
          amount: { type: "string", example: "1.15" },
          currency: { type: "string", example: "USD" },
        },
      },
    },
  },
  Contact: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string", example: "John Doe" },
      phone: { type: "string", example: "+15551234567" },
      email: { type: "string", format: "email", example: "john@example.com" },
      notes: { type: "string", example: "VIP client" },
    },
  },
  CallLog: {
    type: "object",
    properties: {
      id: { type: "string" },
      callerName: { type: "string" },
      callerNumber: { type: "string", example: "+15551234567" },
      status: { type: "string", enum: ["completed", "missed"] },
      startTime: { type: "string", format: "date-time" },
      duration: { type: "string", example: "00:02:30" },
      direction: { type: "string", enum: ["incoming", "outgoing"] },
      hasRecording: { type: "boolean" },
    },
  },
  CallStats: {
    type: "object",
    properties: {
      todayCallsCount: { type: "integer" },
      missedCallsCount: { type: "integer" },
      completedCallsCount: { type: "integer" },
      incomingCallsCount: { type: "integer" },
      outgoingCallsCount: { type: "integer" },
      totalDuration: { type: "integer" },
      averageDuration: { type: "integer" },
    },
  },
  Recording: {
    type: "object",
    properties: {
      sid: { type: "string" },
      duration: { type: "integer" },
      dateCreated: { type: "string", format: "date-time" },
      channels: { type: "integer" },
      source: { type: "string" },
    },
  },
  ForwardingSettings: {
    type: "object",
    properties: {
      enabled: { type: "boolean", example: false },
      forwardingNumber: { type: "string", example: "+15559876543" },
      forwardOnBusy: { type: "boolean", example: true },
      forwardOnNoAnswer: { type: "boolean", example: true },
      forwardOnUnreachable: { type: "boolean", example: false },
    },
  },
};
