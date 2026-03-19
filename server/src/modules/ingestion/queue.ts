import { ConnectionOptions, Queue, QueueOptions } from "bullmq";

import { env } from "../../config/env";
import { IngestionJobData } from "./types";

export const INGESTION_QUEUE_NAME = "document-ingestion";

let queue: Queue<IngestionJobData> | null = null;
let connectionOptions: ConnectionOptions | null = null;

const createConnection = () => {
  if (!env.redisUrl) return null;
  const parsed = new URL(env.redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  } as ConnectionOptions;
};

export const getIngestionConnection = () => {
  if (!connectionOptions) {
    connectionOptions = createConnection();
  }
  return connectionOptions;
};

export const getIngestionQueue = () => {
  if (queue) return queue;
  const redisConnection = getIngestionConnection();
  if (!redisConnection) return null;

  const options: QueueOptions = {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1500,
      },
    },
  };

  queue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, options);
  return queue;
};
