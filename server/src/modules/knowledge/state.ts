import { KnowledgeState } from "@prisma/client";

import { prisma } from "../../lib/prisma";

export const upsertStudentKnowledgeState = async (input: {
  studentId: string;
  courseId: string;
  conceptId: string;
  state: KnowledgeState;
}) => {
  return prisma.studentKnowledgeState.upsert({
    where: {
      studentId_conceptId: {
        studentId: input.studentId,
        conceptId: input.conceptId,
      },
    },
    update: {
      state: input.state,
      courseId: input.courseId,
    },
    create: {
      studentId: input.studentId,
      courseId: input.courseId,
      conceptId: input.conceptId,
      state: input.state,
    },
  });
};

export const getCourseKnowledgeMap = async (input: {
  studentId: string;
  courseId: string;
}) => {
  const [concepts, states] = await Promise.all([
    prisma.concept.findMany({
      where: {
        courseId: input.courseId,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        posX: true,
        posY: true,
      },
    }),
    prisma.studentKnowledgeState.findMany({
      where: {
        studentId: input.studentId,
        courseId: input.courseId,
      },
      select: {
        conceptId: true,
        state: true,
        lastUpdated: true,
      },
    }),
  ]);

  const stateByConcept = new Map(states.map((state) => [state.conceptId, state]));
  return concepts.map((concept) => {
    const state = stateByConcept.get(concept.id);
    return {
      conceptId: concept.id,
      name: concept.name,
      description: concept.description,
      posX: concept.posX,
      posY: concept.posY,
      state: state?.state ?? KnowledgeState.NOT_DEMONSTRATED,
      lastUpdated: state?.lastUpdated ?? null,
    };
  });
};

export const getConceptKnowledgeState = async (input: {
  studentId: string;
  courseId: string;
  conceptId: string;
}) => {
  const concept = await prisma.concept.findFirst({
    where: {
      id: input.conceptId,
      courseId: input.courseId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      posX: true,
      posY: true,
    },
  });

  if (!concept) {
    return null;
  }

  const state = await prisma.studentKnowledgeState.findFirst({
    where: {
      studentId: input.studentId,
      courseId: input.courseId,
      conceptId: input.conceptId,
    },
    select: {
      state: true,
      lastUpdated: true,
    },
  });

  return {
    conceptId: concept.id,
    name: concept.name,
    description: concept.description,
    posX: concept.posX,
    posY: concept.posY,
    state: state?.state ?? KnowledgeState.NOT_DEMONSTRATED,
    lastUpdated: state?.lastUpdated ?? null,
  };
};

