import { Router } from "express";
import tokenRouter from "./token.js"; // Deleted logically
import deviceRouter from "./device.js"; // Deleted logically
import numbersRouter from "./numbers.js";
import forwardingRouter from "./forwarding.js";
import callsRouter from "./calls.js";
import recordingsRouter from "./recordings.js";
import webhooksRouter from "./webhooks.js";
import smsRouter from "./sms.js"; // Deleted logically
import fcmRouter from "./fcm.js"; // Deleted logically

const VoiceRouter = Router();

// VoiceRouter.use("/token", tokenRouter);
// VoiceRouter.use(deviceRouter);
VoiceRouter.use(numbersRouter);
VoiceRouter.use(forwardingRouter);
VoiceRouter.use(callsRouter);
VoiceRouter.use(recordingsRouter);
VoiceRouter.use(webhooksRouter);
// VoiceRouter.use("/sms", smsRouter);
// VoiceRouter.use(fcmRouter);

export default VoiceRouter;
