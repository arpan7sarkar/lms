import { promises as fs } from "node:fs";
import path from "node:path";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

type ExtractInput = {
  filePath: string;
  mimeType: string;
};

const readPlainText = async (filePath: string) => {
  return fs.readFile(filePath, "utf8");
};

const readPdfText = async (filePath: string) => {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  return parsed.text;
};

const readDocxText = async (filePath: string) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
};

export const extractText = async ({ filePath, mimeType }: ExtractInput): Promise<string> => {
  const extension = path.extname(filePath).toLowerCase();
  const normalizedMime = mimeType.toLowerCase();

  if (normalizedMime.startsWith("text/") || extension === ".txt" || extension === ".md") {
    return readPlainText(filePath);
  }

  if (normalizedMime === "application/pdf" || extension === ".pdf") {
    return readPdfText(filePath);
  }

  if (
    normalizedMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    return readDocxText(filePath);
  }

  throw new Error(`Unsupported file type for ingestion: ${mimeType || extension}`);
};
