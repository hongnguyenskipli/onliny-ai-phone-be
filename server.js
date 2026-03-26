import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./src/server/index.js";
import { initSocketIO } from "./src/lib/socketHandler.js";

const PORT = process.env.PORT || 8080;

// Create HTTP server (required for Socket.io to share the same port)
const httpServer = createServer(app);

// Initialize Socket.io on the HTTP server
initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

