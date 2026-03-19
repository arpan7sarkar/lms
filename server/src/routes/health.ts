import { Router } from "express";

import { env } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      nodeEnv: env.nodeEnv,
      time: new Date().toISOString(),
    },
    error: null,
    meta: {},
  });
});

