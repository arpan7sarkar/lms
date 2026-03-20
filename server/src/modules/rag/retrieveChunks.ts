import { generateEmbeddings } from "../ai/embeddings";
import { queryCourseVectors } from "./chroma";

export const retrieveRelevantChunks = async (input: {
  courseId: string;
  query: string;
  limit?: number;
}) => {
  const [queryEmbedding] = await generateEmbeddings([input.query]);
  return queryCourseVectors({
    courseId: input.courseId,
    queryEmbedding,
    limit: input.limit ?? 5,
  });
};

