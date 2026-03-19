import { RequestHandler } from "express";
import { ZodTypeAny } from "zod";

import { sendError } from "../lib/http";

export const validate = (schema: ZodTypeAny): RequestHandler => {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        },
        400,
      );
    }
    req.body = parsed.data;
    return next();
  };
};

