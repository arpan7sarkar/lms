import { env } from "../../config/env";

const EMBEDDING_DIMENSION = 256;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const hashEmbedding = (text: string) => {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    vector[index % EMBEDDING_DIMENSION] += code / 255;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
};

const embedWithGemini = async (text: string) => {
  if (!env.geminiApiKey) {
    return hashEmbedding(text);
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/${env.geminiEmbeddingModel}:embedContent?key=${env.geminiApiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.geminiEmbeddingModel,
      content: {
        parts: [{ text }],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini embedding failed (${response.status})`);
  }

  const parsed = (await response.json()) as {
    embedding?: {
      values?: number[];
    };
  };

  const values = parsed.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini embedding response is missing values");
  }

  return values;
};

const embedWithRetry = async (text: string, attempts = 3): Promise<number[]> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await embedWithGemini(text);
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      await wait(300 * attempt);
    }
  }
  throw new Error("Embedding retry loop exited unexpectedly");
};

export const generateEmbeddings = async (texts: string[]) => {
  if (texts.length === 0) return [];

  const results = new Array<number[]>(texts.length);
  const concurrency = Math.max(1, env.embeddingConcurrency);
  let cursor = 0;

  const workers = new Array(Math.min(concurrency, texts.length)).fill(null).map(async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await embedWithRetry(texts[index]);
    }
  });

  await Promise.all(workers);
  return results;
};

