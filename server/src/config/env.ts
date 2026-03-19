import dotenv from "dotenv";

dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const requiredInProduction = (key: string, fallbackInDev: string): string => {
  const value = process.env[key];
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (value) return value;
  if (nodeEnv === "production") throw new Error(`Missing required env var: ${key}`);
  return fallbackInDev;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",
  jwtSecret: requiredInProduction("JWT_SECRET", "dev-only-insecure-secret"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  chromaUrl: process.env.CHROMA_URL,
  geminiApiKey: process.env.GEMINI_API_KEY,
};

