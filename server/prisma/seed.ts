import { PrismaClient, KnowledgeState, Role, IngestionStatus } from "@prisma/client";

const prisma = new PrismaClient();

const main = async () => {
  const faculty = await prisma.user.upsert({
    where: { email: "faculty@socraticai.local" },
    update: {},
    create: {
      name: "Dr. Ada Faculty",
      email: "faculty@socraticai.local",
      passwordHash: "seeded-placeholder-hash",
      role: Role.FACULTY,
      isVerified: true,
    },
  });

  const student = await prisma.user.upsert({
    where: { email: "student@socraticai.local" },
    update: {},
    create: {
      name: "Sam Student",
      email: "student@socraticai.local",
      passwordHash: "seeded-placeholder-hash",
      role: Role.STUDENT,
      isVerified: true,
    },
  });

  const course = await prisma.course.upsert({
    where: { courseCode: "CS101" },
    update: {},
    create: {
      title: "Foundations of Computing",
      description: "Seed course for local LMS development.",
      courseCode: "CS101",
      semester: "Spring 2026",
      facultyId: faculty.id,
    },
  });

  await prisma.courseEnrollment.upsert({
    where: {
      courseId_studentId: {
        courseId: course.id,
        studentId: student.id,
      },
    },
    update: {},
    create: {
      courseId: course.id,
      studentId: student.id,
    },
  });

  const conceptNames = [
    "Binary Representation",
    "Logic Gates",
    "Boolean Algebra",
    "Variables",
    "Control Flow",
    "Functions",
    "Arrays",
    "Objects",
    "Recursion",
    "Time Complexity",
  ];

  const concepts = [];
  for (const conceptName of conceptNames) {
    const concept = await prisma.concept.upsert({
      where: {
        courseId_name: {
          courseId: course.id,
          name: conceptName,
        },
      },
      update: {},
      create: {
        courseId: course.id,
        name: conceptName,
      },
    });
    concepts.push(concept);
  }

  for (let index = 0; index < concepts.length; index += 1) {
    await prisma.studentKnowledgeState.upsert({
      where: {
        studentId_conceptId: {
          studentId: student.id,
          conceptId: concepts[index].id,
        },
      },
      update: {},
      create: {
        studentId: student.id,
        courseId: course.id,
        conceptId: concepts[index].id,
        state: index < 2 ? KnowledgeState.PARTIAL : KnowledgeState.NOT_DEMONSTRATED,
      },
    });
  }

  for (let index = 0; index < concepts.length - 1; index += 1) {
    await prisma.conceptEdge.upsert({
      where: {
        parentConceptId_childConceptId: {
          parentConceptId: concepts[index].id,
          childConceptId: concepts[index + 1].id,
        },
      },
      update: {},
      create: {
        parentConceptId: concepts[index].id,
        childConceptId: concepts[index + 1].id,
      },
    });
  }

  await prisma.document.upsert({
    where: { id: "seed-document-cs101" },
    update: {},
    create: {
      id: "seed-document-cs101",
      courseId: course.id,
      fileName: "intro-computing.pdf",
      fileUrl: "/seed/intro-computing.pdf",
      mimeType: "application/pdf",
      sizeBytes: 102400,
      status: IngestionStatus.DONE,
      processedAt: new Date(),
    },
  });

  console.log("Seed complete");
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
