import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { findEarliestCognitiveGap } from "../modules/tutor/gapEngine";

const tutorQuestionSchema = z.object({
  courseId: z.string().trim().min(1),
  question: z.string().trim().min(3).max(4000),
  sessionId: z.string().trim().min(1).optional(),
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

const resolveSession = async (input: {
  studentId: string;
  courseId: string;
  sessionId?: string;
}) => {
  if (input.sessionId) {
    return prisma.chatSession.findFirst({
      where: {
        id: input.sessionId,
        studentId: input.studentId,
        courseId: input.courseId,
        deletedAt: null,
      },
      select: { id: true, messages: true },
    });
  }

  return prisma.chatSession.create({
    data: {
      studentId: input.studentId,
      courseId: input.courseId,
      messages: [] as Prisma.InputJsonValue,
    },
    select: { id: true, messages: true },
  });
};

export const tutorRouter = Router();
tutorRouter.use(requireAuth, requireRole([Role.STUDENT]));

tutorRouter.post("/question", validate(tutorQuestionSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const { courseId, question, sessionId } = req.body as z.infer<typeof tutorQuestionSchema>;

  const enrollment = await assertStudentEnrollment(auth.userId, courseId);
  if (!enrollment) {
    return sendError(res, { code: "FORBIDDEN", message: "You are not enrolled in this course" }, 403);
  }

  const session = await resolveSession({
    studentId: auth.userId,
    courseId,
    sessionId,
  });

  if (!session) {
    return sendError(res, { code: "NOT_FOUND", message: "Tutor session not found" }, 404);
  }

  const gapResult = await findEarliestCognitiveGap({
    studentId: auth.userId,
    courseId,
    question,
  });

  const mode = gapResult.gapConcept ? "SOCRATIC" : "ANSWER";
  const message = gapResult.gapConcept
    ? `Before we continue, let's check your understanding of ${gapResult.gapConcept.name}.`
    : "No prerequisite gap detected. Proceed with direct answer generation.";

  return sendSuccess(res, {
    sessionId: session.id,
    mode,
    targetConceptId: gapResult.targetConcept?.id ?? null,
    targetConceptName: gapResult.targetConcept?.name ?? null,
    gapConceptId: gapResult.gapConcept?.conceptId ?? null,
    gapConceptName: gapResult.gapConcept?.name ?? null,
    message,
  });
});
