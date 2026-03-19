import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { env } from "../config/env";
import { requireAuth } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum([Role.STUDENT, Role.FACULTY]).default(Role.STUDENT),
});

const loginSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

const signToken = (userId: string, role: Role) => {
  return jwt.sign(
    { sub: userId, role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] },
  );
};

export const authRouter = Router();

authRouter.post("/signup", validate(signupSchema), async (req, res) => {
  const { name, email, password, role } = req.body as z.infer<typeof signupSchema>;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
    });

    const token = signToken(user.id, user.role);
    return sendSuccess(res, { token, user }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return sendError(res, { code: "CONFLICT", message: "Email is already registered" }, 409);
    }
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not create account" }, 500);
  }
});

authRouter.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findFirst({
    where: {
      email,
      deletedAt: null,
    },
  });

  if (!user) {
    return sendError(res, { code: "UNAUTHORIZED", message: "Invalid email or password" }, 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return sendError(res, { code: "UNAUTHORIZED", message: "Invalid email or password" }, 401);
  }

  const token = signToken(user.id, user.role);
  return sendSuccess(res, {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
    },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) {
    return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);
  }

  const user = await prisma.user.findFirst({
    where: {
      id: auth.userId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isVerified: true,
      createdAt: true,
    },
  });

  if (!user) {
    return sendError(res, { code: "NOT_FOUND", message: "User not found" }, 404);
  }

  return sendSuccess(res, user);
});
