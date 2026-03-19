import { createApp } from "./app";
import { env } from "./config/env";
import { startIngestionWorker } from "./modules/ingestion/worker";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
  startIngestionWorker();
});
