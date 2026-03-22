import { KnowledgeState } from "@prisma/client";

import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

type CourseConcept = {
  id: string;
  name: string;
  description: string | null;
};

type ConceptEdge = {
  parentConceptId: string;
  childConceptId: string;
};

type AncestorState = {
  conceptId: string;
  name: string;
  description: string | null;
  depth: number;
  state: KnowledgeState;
};

export type GapEngineResult = {
  targetConcept: CourseConcept | null;
  ancestors: AncestorState[];
  gapConcept: AncestorState | null;
};

const GAP_STATES = new Set<KnowledgeState>([
  KnowledgeState.NOT_DEMONSTRATED,
  KnowledgeState.NEEDS_REFRESH,
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "which",
  "why",
  "with",
]);

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const identifyTargetWithGemini = async (
  question: string,
  concepts: CourseConcept[],
): Promise<CourseConcept | null> => {
  if (!env.geminiApiKey || concepts.length === 0) return null;

  const prompt = [
    "You are classifying a student question to one concept in a known concept list.",
    "Return strictly one JSON object and no extra text:",
    '{ "conceptId": "exact-id-from-list" }',
    "If no concept is a good fit, return:",
    '{ "conceptId": null }',
    "",
    `Question: ${question}`,
    "Concept list:",
    JSON.stringify(
      concepts.map((concept) => ({
        id: concept.id,
        name: concept.name,
        description: concept.description ?? "",
      })),
    ),
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
    throw new Error(`Gemini concept identification failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  const parsed = parseJsonObject(raw);
  const conceptId = typeof parsed?.conceptId === "string" ? parsed.conceptId : null;
  if (!conceptId) return null;

  return concepts.find((concept) => concept.id === conceptId) ?? null;
};

const identifyTargetFallback = (question: string, concepts: CourseConcept[]): CourseConcept | null => {
  if (concepts.length === 0) return null;
  if (concepts.length === 1) return concepts[0];

  const questionLower = question.toLowerCase();
  const questionTokens = new Set(tokenize(question));

  let best: { concept: CourseConcept; score: number } | null = null;
  for (const concept of concepts) {
    let score = 0;
    const conceptNameLower = concept.name.toLowerCase();

    if (questionLower.includes(conceptNameLower)) {
      score += 12;
    }

    for (const token of tokenize(concept.name)) {
      if (questionTokens.has(token)) score += 3;
    }

    for (const token of tokenize(concept.description ?? "")) {
      if (questionTokens.has(token)) score += 1;
    }

    if (!best || score > best.score) {
      best = { concept, score };
    }
  }

  if (!best || best.score <= 0) {
    return null;
  }

  return best.concept;
};

const identifyTargetConcept = async (question: string, concepts: CourseConcept[]) => {
  try {
    const geminiPick = await identifyTargetWithGemini(question, concepts);
    if (geminiPick) return geminiPick;
  } catch {
    // Fallback handles deterministic concept matching when Gemini is unavailable/fails.
  }

  return identifyTargetFallback(question, concepts);
};

const getAncestorDepths = (targetConceptId: string, edges: ConceptEdge[]) => {
  const parentsByChild = new Map<string, string[]>();
  for (const edge of edges) {
    const parents = parentsByChild.get(edge.childConceptId) ?? [];
    parents.push(edge.parentConceptId);
    parentsByChild.set(edge.childConceptId, parents);
  }

  const maxDepthByConcept = new Map<string, number>();
  const queue: Array<{ conceptId: string; depth: number }> = [{ conceptId: targetConceptId, depth: 0 }];
  const maxDepthLimit = Math.max(1, edges.length + 1);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const parents = parentsByChild.get(current.conceptId) ?? [];
    for (const parentId of parents) {
      const nextDepth = current.depth + 1;
      const previousDepth = maxDepthByConcept.get(parentId) ?? -1;
      if (nextDepth > previousDepth) {
        maxDepthByConcept.set(parentId, nextDepth);
        if (nextDepth <= maxDepthLimit) {
          queue.push({ conceptId: parentId, depth: nextDepth });
        }
      }
    }
  }

  return maxDepthByConcept;
};

export const findEarliestCognitiveGap = async (input: {
  studentId: string;
  courseId: string;
  question: string;
}): Promise<GapEngineResult> => {
  const concepts = await prisma.concept.findMany({
    where: {
      courseId: input.courseId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (concepts.length === 0) {
    return {
      targetConcept: null,
      ancestors: [],
      gapConcept: null,
    };
  }

  const targetConcept = await identifyTargetConcept(input.question, concepts);
  if (!targetConcept) {
    return {
      targetConcept: null,
      ancestors: [],
      gapConcept: null,
    };
  }

  const edges = await prisma.conceptEdge.findMany({
    where: {
      parent: {
        courseId: input.courseId,
        deletedAt: null,
      },
      child: {
        deletedAt: null,
      },
    },
    select: {
      parentConceptId: true,
      childConceptId: true,
    },
  });

  const ancestorDepthByConceptId = getAncestorDepths(targetConcept.id, edges);
  const ancestorConceptIds = [...ancestorDepthByConceptId.keys()];
  if (ancestorConceptIds.length === 0) {
    return {
      targetConcept,
      ancestors: [],
      gapConcept: null,
    };
  }

  const states = await prisma.studentKnowledgeState.findMany({
    where: {
      studentId: input.studentId,
      courseId: input.courseId,
      conceptId: {
        in: ancestorConceptIds,
      },
    },
    select: {
      conceptId: true,
      state: true,
    },
  });

  const stateByConceptId = new Map(states.map((state) => [state.conceptId, state.state]));
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));

  const ancestors = ancestorConceptIds
    .map((conceptId): AncestorState | null => {
      const concept = conceptById.get(conceptId);
      if (!concept) return null;

      return {
        conceptId: concept.id,
        name: concept.name,
        description: concept.description,
        depth: ancestorDepthByConceptId.get(concept.id) ?? 0,
        state: stateByConceptId.get(concept.id) ?? KnowledgeState.NOT_DEMONSTRATED,
      };
    })
    .filter((item): item is AncestorState => item !== null)
    .sort((left, right) => {
      if (right.depth !== left.depth) return right.depth - left.depth;
      return left.name.localeCompare(right.name);
    });

  const gapConcept = ancestors.find((ancestor) => GAP_STATES.has(ancestor.state)) ?? null;

  return {
    targetConcept,
    ancestors,
    gapConcept,
  };
};
