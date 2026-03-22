import { env } from "../../config/env";

export type ExtractedConcept = {
  name: string;
  description?: string;
  prerequisites: string[];
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "below",
  "could",
  "every",
  "first",
  "found",
  "great",
  "other",
  "shall",
  "their",
  "there",
  "these",
  "those",
  "under",
  "which",
  "while",
  "where",
  "without",
  "within",
  "because",
  "between",
  "through",
  "during",
  "before",
  "after",
  "above",
  "would",
  "should",
  "student",
  "students",
  "course",
  "chapter",
  "section",
]);

const normalizeConceptName = (name: string) =>
  name
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const parseConceptArray = (rawText: string): ExtractedConcept[] => {
  const arrayStart = rawText.indexOf("[");
  const arrayEnd = rawText.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawText.slice(arrayStart, arrayEnd + 1)) as Array<{
      name?: unknown;
      description?: unknown;
      prerequisites?: unknown;
    }>;

    return parsed
      .map((item) => {
        const name = typeof item.name === "string" ? normalizeConceptName(item.name) : "";
        const description = typeof item.description === "string" ? item.description.trim() : undefined;
        const prerequisites = Array.isArray(item.prerequisites)
          ? item.prerequisites
              .filter((value): value is string => typeof value === "string")
              .map((value) => normalizeConceptName(value))
              .filter(Boolean)
          : [];

        return { name, description, prerequisites };
      })
      .filter((item) => item.name.length > 0);
  } catch {
    return [];
  }
};

const fallbackExtraction = (text: string, maxConcepts: number): ExtractedConcept[] => {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 5 && !STOP_WORDS.has(token));

  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  const conceptNames = [...frequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxConcepts)
    .map(([token]) => normalizeConceptName(token));

  return conceptNames.map((name, index) => ({
    name,
    description: undefined,
    prerequisites: index === 0 ? [] : [conceptNames[index - 1]],
  }));
};

const extractWithGemini = async (text: string, maxConcepts: number): Promise<ExtractedConcept[]> => {
  if (!env.geminiApiKey) {
    return [];
  }

  const prompt = [
    "Extract key learning concepts from the course text.",
    "Return strictly as a JSON array.",
    `Maximum ${maxConcepts} concepts.`,
    "Each item must follow:",
    '{ "name": "string", "description": "string", "prerequisites": ["string"] }',
    "Only include meaningful, distinct, teachable concepts.",
    "",
    "Course text:",
    text.slice(0, 28000),
  ].join("\n");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${env.geminiApiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini concept extraction failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  return parseConceptArray(raw);
};

export const extractConceptsFromText = async (text: string, maxConcepts = 12): Promise<ExtractedConcept[]> => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];

  try {
    const fromGemini = await extractWithGemini(trimmed, maxConcepts);
    if (fromGemini.length > 0) {
      return fromGemini.slice(0, maxConcepts);
    }
  } catch {
    // Fall through to deterministic fallback extraction.
  }

  return fallbackExtraction(trimmed, maxConcepts);
};

