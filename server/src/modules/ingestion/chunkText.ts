import { TextChunk } from "./types";

const tokenizeWithOffsets = (text: string) => {
  const tokens: Array<{ value: string; start: number; end: number }> = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
    match = regex.exec(text);
  }
  return tokens;
};

export const chunkText = (text: string, maxTokens = 400, overlap = 50): TextChunk[] => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const tokens = tokenizeWithOffsets(normalized);
  if (tokens.length === 0) return [];

  const step = Math.max(1, maxTokens - overlap);
  const chunks: TextChunk[] = [];

  for (let cursor = 0, chunkIndex = 0; cursor < tokens.length; cursor += step, chunkIndex += 1) {
    const slice = tokens.slice(cursor, cursor + maxTokens);
    if (slice.length === 0) break;

    chunks.push({
      chunkIndex,
      content: slice.map((token) => token.value).join(" "),
      startChar: slice[0].start,
      endChar: slice[slice.length - 1].end,
    });

    if (cursor + maxTokens >= tokens.length) break;
  }

  return chunks;
};

