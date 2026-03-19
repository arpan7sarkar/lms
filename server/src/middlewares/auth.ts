import { Role } from "@prisma/client";
import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { sendError } from "../lib/http";

type JwtPayload = {
  sub: string;
  role: Role;
};

const extractBearerToken = (authHeader?: string) => {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return sendError(res, { code: "UNAUTHORIZED", message: "Missing bearer token" }, 401);
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    if (!payload?.sub || !payload?.role) {
      return sendError(res, { code: "UNAUTHORIZED", message: "Invalid token" }, 401);
    }
    req.auth = {
      userId: payload.sub,
      role: payload.role,
    };
    return next();
  } catch {
    return sendError(res, { code: "UNAUTHORIZED", message: "Token verification failed" }, 401);
  }
};

export const requireRole = (allowedRoles: Role[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return sendError(res, { code: "FORBIDDEN", message: "Insufficient role permissions" }, 403);
    }
    return next();
  };
};

