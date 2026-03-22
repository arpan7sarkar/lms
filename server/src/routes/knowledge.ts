import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middlewares/auth";
import { getConceptKnowledgeState, getCourseKnowledgeMap } from "../modules/knowledge/state";

const courseParamsSchema = z.object({
  courseId: z.string().trim().min(1),
});

const conceptParamsSchema = z.object({
  courseId: z.string().trim().min(1),
  conceptId: z.string().trim().min(1),
});

const assertStudentEnrollment = async (studentId: string, courseId: string) => {
  return prisma.courseEnrollment.findFirst({
    where: {
      studentId,
      courseId,
      course: {
        deletedAt: null,
      },
    },
    select: { id: true },
  });
};

export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth, requireRole([Role.STUDENT]));

knowledgeRouter.get("/:courseId", async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const parsed = courseParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid course id" }, 400);
  }

  const enrollment = await assertStudentEnrollment(auth.userId, parsed.data.courseId);
  if (!enrollment) {
    return sendError(res, { code: "FORBIDDEN", message: "You are not enrolled in this course" }, 403);
  }

  const knowledge = await getCourseKnowledgeMap({
    studentId: auth.userId,
    courseId: parsed.data.courseId,
  });

  return sendSuccess(res, knowledge, 200, { count: knowledge.length });
});

knowledgeRouter.get("/:courseId/:conceptId", async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const parsed = conceptParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid course or concept id" }, 400);
  }

  const enrollment = await assertStudentEnrollment(auth.userId, parsed.data.courseId);
  if (!enrollment) {
    return sendError(res, { code: "FORBIDDEN", message: "You are not enrolled in this course" }, 403);
  }

  const knowledge = await getConceptKnowledgeState({
    studentId: auth.userId,
    courseId: parsed.data.courseId,
    conceptId: parsed.data.conceptId,
  });

  if (!knowledge) {
    return sendError(res, { code: "NOT_FOUND", message: "Concept not found in this course" }, 404);
  }

  return sendSuccess(res, knowledge);
});

