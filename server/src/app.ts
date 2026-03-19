import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
import { sendError } from "./lib/http";
import { authRouter } from "./routes/auth";
import { coursesRouter } from "./routes/courses";
import { healthRouter } from "./routes/health";

export const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
  });

  app.get("/", (_req, res) =>
    res.json({ success: true, data: { name: "lms-server" }, error: null, meta: {} }),
  );
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/courses", coursesRouter);
  app.use("/health", healthRouter);
  app.use("/api/v1/health", healthRouter);

  app.use((_req, res) => {
    sendError(res, { code: "NOT_FOUND", message: "Not found" }, 404);
  });

  return app;
};
