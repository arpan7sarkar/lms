import { Response } from "express";

type ErrorPayload = {
  code: string;
  message: string;
};

type MetaPayload = Record<string, unknown>;

export const sendSuccess = (
  res: Response,
  data: unknown,
  statusCode = 200,
  meta: MetaPayload = {},
) => {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta,
  });
};

export const sendError = (res: Response, error: ErrorPayload, statusCode = 400, meta: MetaPayload = {}) => {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error,
    meta,
  });
};

