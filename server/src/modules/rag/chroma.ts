import { ChromaClient, Collection } from "chromadb";

import { env } from "../../config/env";
import { TextChunk } from "../ingestion/types";

type QueryChunkResult = {
  id: string;
  document?: string;
  distance?: number;
  metadata?: Record<string, boolean | number | string>;
};

let client: ChromaClient | null = null;
let collection: Collection | null = null;

const getClient = () => {
  if (!client) {
    client = new ChromaClient({
      path: env.chromaUrl,
    });
  }
  return client;
};

const getCollection = async () => {
  if (!collection) {
    collection = await getClient().getOrCreateCollection({
      name: env.chromaCollectionName,
    });
  }
  return collection;
};

export const upsertDocumentVectors = async (input: {
  documentId: string;
  courseId: string;
  chunks: TextChunk[];
  embeddings: number[][];
}) => {
  if (input.chunks.length === 0) return;

  const targetCollection = await getCollection();

  await targetCollection.delete({
    where: {
      documentId: input.documentId,
    },
  });

  await targetCollection.upsert({
    ids: input.chunks.map((chunk) => `${input.documentId}:${chunk.chunkIndex}`),
    embeddings: input.embeddings,
    documents: input.chunks.map((chunk) => chunk.content),
    metadatas: input.chunks.map((chunk) => ({
      documentId: input.documentId,
      courseId: input.courseId,
      chunkIndex: chunk.chunkIndex,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    })),
  });
};

export const deleteDocumentVectors = async (documentId: string) => {
  const targetCollection = await getCollection();
  await targetCollection.delete({
    where: {
      documentId,
    },
  });
};

export const queryCourseVectors = async (input: {
  courseId: string;
  queryEmbedding: number[];
  limit?: number;
}): Promise<QueryChunkResult[]> => {
  const targetCollection = await getCollection();
  const result = await targetCollection.query({
    queryEmbeddings: [input.queryEmbedding],
    nResults: input.limit ?? 5,
    where: {
      courseId: input.courseId,
    },
    include: ["documents", "metadatas", "distances"],
  });

  const ids = result.ids?.[0] ?? [];
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  const rows: QueryChunkResult[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    rows.push({
      id: ids[index],
      document: documents[index] ?? undefined,
      metadata: (metadatas[index] as Record<string, boolean | number | string> | null) ?? undefined,
      distance: distances[index] ?? undefined,
    });
  }

  return rows;
};

