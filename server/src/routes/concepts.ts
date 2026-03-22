import { Prisma, Role } from "@prisma/client";
import { Request, Response, Router } from "express";
import { z } from "zod";

import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { extractConceptsFromText } from "../modules/ai/conceptExtraction";

const conceptIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

const courseIdParamSchema = z.object({
  courseId: z.string().trim().min(1),
});

const createConceptSchema = z.object({
  courseId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(4000).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
});

const updateConceptSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
});

const createEdgeSchema = z.object({
  parentConceptId: z.string().trim().min(1),
  childConceptId: z.string().trim().min(1),
});

const extractSchema = z.object({
  courseId: z.string().trim().min(1),
  maxConcepts: z.number().int().min(3).max(30).optional(),
});

const assertFacultyOwnsCourse = async (courseId: string, facultyId: string) => {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      facultyId,
      deletedAt: null,
    },
    select: { id: true },
  });
  return course;
};

const assertConceptOwnedByFaculty = async (conceptId: string, facultyId: string) => {
  return prisma.concept.findFirst({
    where: {
      id: conceptId,
      deletedAt: null,
      course: {
        facultyId,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      courseId: true,
      name: true,
    },
  });
};

export const conceptsRouter = Router();
conceptsRouter.use(requireAuth);

conceptsRouter.post("/extract", requireRole([Role.FACULTY]), validate(extractSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const { courseId, maxConcepts } = req.body as z.infer<typeof extractSchema>;

  const ownedCourse = await assertFacultyOwnsCourse(courseId, auth.userId);
  if (!ownedCourse) {
    return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
  }

  const chunks = await prisma.documentChunk.findMany({
    where: {
      courseId,
      document: {
        deletedAt: null,
      },
    },
    orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
    take: 250,
    select: { content: true },
  });

  if (chunks.length === 0) {
    return sendError(res, { code: "INVALID_STATE", message: "No processed document chunks found for this course" }, 400);
  }

  const extracted = await extractConceptsFromText(
    chunks.map((chunk) => chunk.content).join("\n"),
    maxConcepts ?? 12,
  );

  if (extracted.length === 0) {
    return sendSuccess(res, { concepts: [], edges: [], extractedCount: 0, edgeCount: 0 });
  }

  const allNames = new Set<string>();
  for (const concept of extracted) {
    allNames.add(concept.name);
    for (const prerequisite of concept.prerequisites) {
      allNames.add(prerequisite);
    }
  }

  const conceptByName = new Map<string, { id: string; name: string }>();
  for (const name of allNames) {
    const source = extracted.find((concept) => concept.name === name);
    const concept = await prisma.concept.upsert({
      where: {
        courseId_name: {
          courseId,
          name,
        },
      },
      update: {
        description: source?.description,
      },
      create: {
        courseId,
        name,
        description: source?.description,
      },
      select: {
        id: true,
        name: true,
      },
    });
    conceptByName.set(name, concept);
  }

  const edges = [];
  for (const concept of extracted) {
    const child = conceptByName.get(concept.name);
    if (!child) continue;

    for (const prerequisiteName of concept.prerequisites) {
      const parent = conceptByName.get(prerequisiteName);
      if (!parent || parent.id === child.id) continue;

      try {
        const edge = await prisma.conceptEdge.upsert({
          where: {
            parentConceptId_childConceptId: {
              parentConceptId: parent.id,
              childConceptId: child.id,
            },
          },
          update: {},
          create: {
            parentConceptId: parent.id,
            childConceptId: child.id,
          },
          select: {
            id: true,
            parentConceptId: true,
            childConceptId: true,
          },
        });
        edges.push(edge);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }
      }
    }
  }

  const concepts = [...conceptByName.values()];
  return sendSuccess(res, {
    concepts,
    edges,
    extractedCount: concepts.length,
    edgeCount: edges.length,
  });
});

conceptsRouter.post("/", requireRole([Role.FACULTY]), validate(createConceptSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);
  const body = req.body as z.infer<typeof createConceptSchema>;

  const ownedCourse = await assertFacultyOwnsCourse(body.courseId, auth.userId);
  if (!ownedCourse) {
    return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
  }

  try {
    const concept = await prisma.concept.create({
      data: {
        courseId: body.courseId,
        name: body.name,
        description: body.description,
        posX: body.posX,
        posY: body.posY,
      },
    });
    return sendSuccess(res, concept, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return sendError(res, { code: "CONFLICT", message: "Concept already exists in this course" }, 409);
    }
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not create concept" }, 500);
  }
});

conceptsRouter.patch("/:id", requireRole([Role.FACULTY]), validate(updateConceptSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const params = conceptIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid concept id" }, 400);
  }

  const concept = await assertConceptOwnedByFaculty(params.data.id, auth.userId);
  if (!concept) {
    return sendError(res, { code: "NOT_FOUND", message: "Concept not found" }, 404);
  }

  try {
    const updated = await prisma.concept.update({
      where: { id: concept.id },
      data: req.body as z.infer<typeof updateConceptSchema>,
    });
    return sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return sendError(res, { code: "CONFLICT", message: "Concept name already exists in this course" }, 409);
    }
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not update concept" }, 500);
  }
});

conceptsRouter.delete("/:id", requireRole([Role.FACULTY]), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const params = conceptIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid concept id" }, 400);
  }

  const concept = await assertConceptOwnedByFaculty(params.data.id, auth.userId);
  if (!concept) {
    return sendError(res, { code: "NOT_FOUND", message: "Concept not found" }, 404);
  }

  await prisma.$transaction([
    prisma.conceptEdge.deleteMany({
      where: {
        OR: [{ parentConceptId: concept.id }, { childConceptId: concept.id }],
      },
    }),
    prisma.concept.update({
      where: { id: concept.id },
      data: { deletedAt: new Date() },
    }),
  ]);

  return sendSuccess(res, { id: concept.id, deleted: true });
});

conceptsRouter.post("/edges", requireRole([Role.FACULTY]), validate(createEdgeSchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);
  const body = req.body as z.infer<typeof createEdgeSchema>;

  if (body.parentConceptId === body.childConceptId) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Parent and child concepts must differ" }, 400);
  }

  const parent = await assertConceptOwnedByFaculty(body.parentConceptId, auth.userId);
  const child = await assertConceptOwnedByFaculty(body.childConceptId, auth.userId);
  if (!parent || !child || parent.courseId !== child.courseId) {
    return sendError(res, { code: "FORBIDDEN", message: "Concepts must belong to a course you own" }, 403);
  }

  try {
    const edge = await prisma.conceptEdge.upsert({
      where: {
        parentConceptId_childConceptId: {
          parentConceptId: body.parentConceptId,
          childConceptId: body.childConceptId,
        },
      },
      update: {},
      create: {
        parentConceptId: body.parentConceptId,
        childConceptId: body.childConceptId,
      },
    });
    return sendSuccess(res, edge, 201);
  } catch {
    return sendError(res, { code: "INTERNAL_ERROR", message: "Could not create edge" }, 500);
  }
});

conceptsRouter.delete("/edges/:edgeId", requireRole([Role.FACULTY]), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const edgeId = req.params.edgeId?.trim();
  if (!edgeId) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid edge id" }, 400);
  }

  const edge = await prisma.conceptEdge.findFirst({
    where: {
      id: edgeId,
      parent: {
        course: {
          facultyId: auth.userId,
          deletedAt: null,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!edge) {
    return sendError(res, { code: "NOT_FOUND", message: "Edge not found" }, 404);
  }

  await prisma.conceptEdge.delete({
    where: { id: edge.id },
  });

  return sendSuccess(res, { id: edge.id, deleted: true });
});

const getConceptGraph = async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const params = courseIdParamSchema.safeParse(req.params);
  if (!params.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid course id" }, 400);
  }

  const courseId = params.data.courseId;
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      deletedAt: null,
    },
    select: {
      id: true,
      facultyId: true,
      enrollments: auth.role === Role.STUDENT
        ? {
            where: { studentId: auth.userId },
            select: { id: true },
          }
        : false,
    },
  });

  if (!course) {
    return sendError(res, { code: "NOT_FOUND", message: "Course not found" }, 404);
  }

  if (auth.role === Role.FACULTY && course.facultyId !== auth.userId) {
    return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
  }
  if (auth.role === Role.STUDENT && (!course.enrollments || course.enrollments.length === 0)) {
    return sendError(res, { code: "FORBIDDEN", message: "You are not enrolled in this course" }, 403);
  }

  const [concepts, edges] = await Promise.all([
    prisma.concept.findMany({
      where: {
        courseId,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        posX: true,
        posY: true,
      },
    }),
    prisma.conceptEdge.findMany({
      where: {
        parent: {
          courseId,
          deletedAt: null,
        },
        child: {
          deletedAt: null,
        },
      },
      select: {
        id: true,
        parentConceptId: true,
        childConceptId: true,
      },
    }),
  ]);

  return sendSuccess(res, {
    courseId,
    nodes: concepts,
    edges,
  });
};

conceptsRouter.get("/course/:courseId", getConceptGraph);
conceptsRouter.get("/:courseId", getConceptGraph);
