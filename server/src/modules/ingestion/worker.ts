import { Job, Worker, WorkerOptions } from "bullmq";

import { env } from "../../config/env";
import { INGESTION_QUEUE_NAME, getIngestionConnection } from "./queue";
import { processDocumentIngestion } from "./processDocument";
import { IngestionJobData } from "./types";

let worker: Worker<IngestionJobData> | null = null;

export const startIngestionWorker = () => {
  if (!env.enableIngestionWorker) {
    console.log("Ingestion worker is disabled by ENABLE_INGESTION_WORKER=false");
    return null;
  }

  if (worker) return worker;

  const connection = getIngestionConnection();
  if (!connection) {
    console.log("Ingestion worker not started because REDIS_URL is not configured");
    return null;
  }

  const options: WorkerOptions = {
    connection,
    concurrency: 2,
  };

  worker = new Worker<IngestionJobData>(
    INGESTION_QUEUE_NAME,
    async (job: Job<IngestionJobData>) => {
      await processDocumentIngestion(job.data);
    },
    options,
  );

  worker.on("completed", (job) => {
    console.log(`Ingestion completed for document: ${job.data.documentId}`);
  });
  worker.on("failed", (job, error) => {
    console.error(`Ingestion failed for document: ${job?.data.documentId}`, error);
  });
  worker.on("error", (error) => {
    console.error("Ingestion worker error", error);
  });

  return worker;
};

if (require.main === module) {
  startIngestionWorker();
}

