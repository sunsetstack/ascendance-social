import type { CorsOptions } from "cors";
import { logger } from "@/utils/winston";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:80",
  "http://localhost:8000",
  "http://localhost",
];

export function getAllowedOrigins(): string[] {
  const envOrigins =
    process.env.ALLOWED_ORIGINS?.split(/[,\s]+/)
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  const defaultOrigins =
    process.env.NODE_ENV === "production" ? [] : DEFAULT_ALLOWED_ORIGINS;

  return [...new Set([...defaultOrigins, ...envOrigins])];
}

export function buildCorsOptions(): CorsOptions {
  const allowedOrigins = getAllowedOrigins();

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn(`[Backend CORS] Blocked origin: ${origin}`);
      return callback(
        new Error("Request from this origin is blocked by CORS policy"),
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Set-Cookie"],
    maxAge: 86400,
  };
}
