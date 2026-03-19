export type IngestionJobData = {
  documentId: string;
  courseId: string;
  filePath: string;
  mimeType: string;
};

export type TextChunk = {
  chunkIndex: number;
  content: string;
  startChar: number;
  endChar: number;
};

