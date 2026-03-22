import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";

import { env } from "./config/env";
import { sendError } from "./lib/http";
import { authRouter } from "./routes/auth";
import { conceptsRouter } from "./routes/concepts";
import { coursesRouter } from "./routes/courses";
import { documentsRouter } from "./routes/documents";
import { healthRouter } from "./routes/health";
import { knowledgeRouter } from "./routes/knowledge";

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
  app.use("/api/v1/concepts", conceptsRouter);
  app.use("/api/v1/documents", documentsRouter);
  app.use("/api/v1/knowledge", knowledgeRouter);
  app.use("/health", healthRouter);
  app.use("/api/v1/health", healthRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      return sendError(res, { code: "UPLOAD_ERROR", message: error.message }, 400);
    }
    if (error instanceof Error) {
      return sendError(res, { code: "REQUEST_ERROR", message: error.message }, 400);
    }
    return next(error);
  });

  app.use((_req, res) => {
    sendError(res, { code: "NOT_FOUND", message: "Not found" }, 404);
  });

  return app;
};
