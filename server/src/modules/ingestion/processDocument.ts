import { IngestionStatus } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { generateEmbeddings } from "../ai/embeddings";
import { upsertDocumentVectors } from "../rag/chroma";
import { chunkText } from "./chunkText";
import { extractText } from "./extractText";
import { IngestionJobData } from "./types";

export const processDocumentIngestion = async (job: IngestionJobData) => {
  try {
    await prisma.document.update({
      where: { id: job.documentId },
      data: {
        status: IngestionStatus.PROCESSING,
        errorMessage: null,
      },
    });

    const text = await extractText({ filePath: job.filePath, mimeType: job.mimeType });
    const chunks = chunkText(text, 400, 50);
    const embeddings = await generateEmbeddings(chunks.map((chunk) => chunk.content));

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({
        where: { documentId: job.documentId },
      }),
      ...chunks.map((chunk) =>
        prisma.documentChunk.create({
          data: {
            documentId: job.documentId,
            courseId: job.courseId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
          },
        }),
      ),
    ]);
    await upsertDocumentVectors({
      documentId: job.documentId,
      courseId: job.courseId,
      chunks,
      embeddings,
    });

    await prisma.document.update({
      where: { id: job.documentId },
      data: {
        status: IngestionStatus.DONE,
        processedAt: new Date(),
        errorMessage: null,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Ingestion failed";
    await prisma.document.update({
      where: { id: job.documentId },
      data: {
        status: IngestionStatus.FAILED,
        errorMessage,
      },
    });
    throw error;
  }
};
