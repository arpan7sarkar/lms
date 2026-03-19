import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";

const createCourseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  semester: z.string().trim().max(50).optional(),
});

const joinCourseSchema = z.object({
  joinCode: z.string().trim().min(4).max(20),
});

const courseIdParamSchema = z.object({
  courseId: z.string().trim().min(1),
});

const makeCourseCode = (title: string) => {
  const slug = title
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `${slug || "COURSE"}${suffix}`;
};

const asCourseResponse = (course: {
  id: string;
  title: string;
  description: string | null;
  semester: string | null;
  courseCode: string;
  isActive: boolean;
  facultyId: string;
  createdAt: Date;
}) => ({
  id: course.id,
  title: course.title,
  description: course.description,
  semester: course.semester,
  joinCode: course.courseCode,
  isActive: course.isActive,
  facultyId: course.facultyId,
  createdAt: course.createdAt,
});

export const coursesRouter = Router();

coursesRouter.use(requireAuth);

coursesRouter.post("/", requireRole([Role.FACULTY]), validate(createCourseSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const { title, description, semester } = req.body as z.infer<typeof createCourseSchema>;

  try {
    const course = await prisma.course.create({
      data: {
        title,
        description,
        semester,
        facultyId: auth.userId,
        courseCode: makeCourseCode(title),
      },
      select: {
        id: true,
        title: true,
        description: true,
        semester: true,
        courseCode: true,
        isActive: true,
        facultyId: true,
        createdAt: true,
      },
    });
    return sendSuccess(res, asCourseResponse(course), 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return sendError(res, { code: "CONFLICT", message: "Course code generation collision, retry request" }, 409);
    }
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not create course" }, 500);
  }
});

coursesRouter.get("/", async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  if (auth.role === Role.FACULTY) {
    const courses = await prisma.course.findMany({
      where: { facultyId: auth.userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        semester: true,
        courseCode: true,
        isActive: true,
        facultyId: true,
        createdAt: true,
      },
    });
    return sendSuccess(
      res,
      courses.map(asCourseResponse),
      200,
      { count: courses.length, role: auth.role },
    );
  }

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { studentId: auth.userId, course: { deletedAt: null } },
    orderBy: { joinedAt: "desc" },
    select: {
      course: {
        select: {
          id: true,
          title: true,
          description: true,
          semester: true,
          courseCode: true,
          isActive: true,
          facultyId: true,
          createdAt: true,
        },
      },
      joinedAt: true,
    },
  });

  const data = enrollments.map((entry) => ({
    ...asCourseResponse(entry.course),
    joinedAt: entry.joinedAt,
  }));

  return sendSuccess(res, data, 200, { count: data.length, role: auth.role });
});

coursesRouter.get("/:courseId", async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const parsedParams = courseIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid course id" }, 400);
  }

  const { courseId } = parsedParams.data;

  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      semester: true,
      courseCode: true,
      isActive: true,
      facultyId: true,
      createdAt: true,
    },
  });

  if (!course) {
    return sendError(res, { code: "NOT_FOUND", message: "Course not found" }, 404);
  }

  if (auth.role === Role.FACULTY) {
    if (course.facultyId !== auth.userId) {
      return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
    }
    return sendSuccess(res, asCourseResponse(course));
  }

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { courseId: course.id, studentId: auth.userId },
    select: { id: true, joinedAt: true },
  });

  if (!enrollment) {
    return sendError(res, { code: "FORBIDDEN", message: "Join the course to access it" }, 403);
  }

  return sendSuccess(res, {
    ...asCourseResponse(course),
    joinedAt: enrollment.joinedAt,
  });
});

coursesRouter.post("/join", requireRole([Role.STUDENT]), validate(joinCourseSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const { joinCode } = req.body as z.infer<typeof joinCourseSchema>;

  const course = await prisma.course.findFirst({
    where: {
      courseCode: joinCode.toUpperCase(),
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      description: true,
      semester: true,
      courseCode: true,
      isActive: true,
      facultyId: true,
      createdAt: true,
    },
  });

  if (!course) {
    return sendError(res, { code: "NOT_FOUND", message: "Invalid join code" }, 404);
  }

  try {
    const enrollment = await prisma.courseEnrollment.upsert({
      where: {
        courseId_studentId: {
          courseId: course.id,
          studentId: auth.userId,
        },
      },
      update: {},
      create: {
        courseId: course.id,
        studentId: auth.userId,
      },
      select: {
        joinedAt: true,
      },
    });

    return sendSuccess(res, {
      ...asCourseResponse(course),
      joinedAt: enrollment.joinedAt,
    });
  } catch {
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not join course" }, 500);
  }
});

