import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
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

  app.get("/", (_req, res) =>
    res.json({ success: true, data: { name: "lms-server" }, error: null, meta: {} }),
  );
  app.use("/health", healthRouter);
  app.use("/api/v1/health", healthRouter);

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "Not found" },
      meta: {},
    });
  });

  return app;
};

