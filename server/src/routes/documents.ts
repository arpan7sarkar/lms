import { IngestionStatus, Role } from "@prisma/client";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import multer from "multer";
import { Request, Response, Router } from "express";
import { z } from "zod";

import { env } from "../config/env";
import { sendError, sendSuccess } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { processDocumentIngestion } from "../modules/ingestion/processDocument";
import { getIngestionQueue } from "../modules/ingestion/queue";

const uploadsDir = path.resolve(process.cwd(), env.uploadDir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedMimeTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.maxUploadBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

const uploadBodySchema = z.object({
  courseId: z.string().trim().min(1),
});

const idParamSchema = z.object({
  id: z.string().trim().min(1),
});

const courseIdParamSchema = z.object({
  courseId: z.string().trim().min(1),
});

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireRole([Role.FACULTY]));

documentsRouter.post("/upload", upload.single("file"), validate(uploadBodySchema), async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);
  if (!req.file) return sendError(res, { code: "VALIDATION_ERROR", message: "File is required" }, 400);

  const { courseId } = req.body as z.infer<typeof uploadBodySchema>;

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      facultyId: auth.userId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!course) {
    return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
  }

  const relativePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");
  const document = await prisma.document.create({
    data: {
      courseId,
      fileName: req.file.originalname,
      fileUrl: relativePath,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      status: IngestionStatus.PENDING,
    },
    select: {
      id: true,
      courseId: true,
      fileName: true,
      fileUrl: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      uploadedAt: true,
    },
  });

  const jobData = {
    documentId: document.id,
    courseId,
    filePath: path.resolve(req.file.path),
    mimeType: req.file.mimetype,
  };

  const queue = getIngestionQueue();
  if (queue) {
    await queue.add("ingest-document", jobData, {
      jobId: document.id,
    });
    return sendSuccess(res, { ...document, queued: true }, 201);
  }

  void processDocumentIngestion(jobData).catch((error: unknown) => {
    console.error(`Fallback ingestion failed for document ${document.id}`, error);
  });

  return sendSuccess(res, { ...document, queued: false }, 201);
});

const listDocumentsForCourse = async (req: Request, res: Response) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const parsed = courseIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid course id" }, 400);
  }

  const course = await prisma.course.findFirst({
    where: {
      id: parsed.data.courseId,
      facultyId: auth.userId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!course) {
    return sendError(res, { code: "FORBIDDEN", message: "You do not own this course" }, 403);
  }

  const documents = await prisma.document.findMany({
    where: {
      courseId: parsed.data.courseId,
      deletedAt: null,
    },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      courseId: true,
      fileName: true,
      fileUrl: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      errorMessage: true,
      uploadedAt: true,
      processedAt: true,
      _count: {
        select: {
          chunks: true,
        },
      },
    },
  });

  return sendSuccess(
    res,
    documents.map((document) => ({
      ...document,
      chunkCount: document._count.chunks,
    })),
    200,
    { count: documents.length },
  );
};

documentsRouter.get("/course/:courseId", listDocumentsForCourse);
documentsRouter.get("/:courseId", listDocumentsForCourse);

documentsRouter.delete("/:id", async (req, res) => {
  const auth = req.auth;
  if (!auth) return sendError(res, { code: "UNAUTHORIZED", message: "Missing auth context" }, 401);

  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendError(res, { code: "VALIDATION_ERROR", message: "Invalid document id" }, 400);
  }

  const document = await prisma.document.findFirst({
    where: {
      id: parsed.data.id,
      deletedAt: null,
      course: {
        facultyId: auth.userId,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      fileUrl: true,
    },
  });

  if (!document) {
    return sendError(res, { code: "NOT_FOUND", message: "Document not found" }, 404);
  }

  await prisma.$transaction([
    prisma.documentChunk.deleteMany({
      where: { documentId: document.id },
    }),
    prisma.document.update({
      where: { id: document.id },
      data: {
        deletedAt: new Date(),
        status: IngestionStatus.FAILED,
        errorMessage: "Deleted by faculty",
      },
    }),
  ]);

  const absoluteFilePath = path.resolve(process.cwd(), document.fileUrl);
  try {
    await fsp.unlink(absoluteFilePath);
  } catch {
    // file may already be missing; DB deletion is the source of truth.
  }

  return sendSuccess(res, { id: document.id, deleted: true });
});
