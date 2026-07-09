import winston from "winston";
import os from "node:os";
import { getCorrelationId, getRequestContext } from "@/runtime/request-context";

const SENSITIVE_KEY_PATTERN =
  /password|passphrase|token|secret|authorization|cookie|api[-_]?key|jwt/i;
const MAX_REDACTION_DEPTH = 4;

function serializeError(
  error: Error,
  seen = new WeakSet<object>(),
): Record<string, unknown> {
  if (seen.has(error)) {
    return { message: "[CircularError]" };
  }
  seen.add(error);

  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if ("code" in error) {
    serialized.code = (error as { code?: unknown }).code;
  }

  if (error.cause !== undefined) {
    serialized.cause = sanitizeValue(error.cause, 1, seen);
  }

  return serialized;
}

function sanitizeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value instanceof Error) {
    return serializeError(value, seen);
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};

    for (const [key, childValue] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeValue(childValue, depth + 1, seen);
    }

    return sanitized;
  }

  return value;
}

const attachCorrelationId = winston.format((info) => {
  const requestContext = getRequestContext();
  const correlationId = requestContext?.correlationId ?? getCorrelationId();
  if (correlationId && info.correlationId === undefined) {
    info.correlationId = correlationId;
  }
  if (requestContext?.userId && info.userId === undefined) {
    info.userId = requestContext.userId;
  }

  return info;
});

const attachLogContract = winston.format((info) => {
  info.service = info.service ?? process.env.SERVICE_NAME ?? "ascendance-backend";
  info.env = info.env ?? process.env.NODE_ENV ?? "development";
  info.host = info.host ?? os.hostname();
  info.pid = info.pid ?? process.pid;

  for (const [key, value] of Object.entries(info)) {
    if (key === "level" || key === "message" || key === "timestamp") {
      continue;
    }

    info[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitizeValue(value);
  }

  return info;
});

const jsonLogFormat = winston.format.combine(
  attachCorrelationId(),
  attachLogContract(),
  winston.format.timestamp(),
  winston.format.json(),
);

const consoleLogFormat = winston.format.combine(
  attachCorrelationId(),
  attachLogContract(),
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(
    ({ timestamp, level, message, event, correlationId, ...meta }) => {
      const correlation =
        typeof correlationId === "string" ? ` [${correlationId}]` : "";
      const eventName = typeof event === "string" ? ` ${event}` : "";
      const metaStr = Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : "";
      return `[${timestamp}]${correlation}${eventName} ${level}: ${message}${metaStr}`;
    },
  ),
);

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || "info";
const testTransport = isTest
  ? new winston.transports.Console({ silent: true })
  : null;
const combinedTransport = isTest
  ? null
  : new winston.transports.File({ filename: "app.log" });
const productionConsoleTransport = isProduction
  ? new winston.transports.Console({
      format: jsonLogFormat,
      stderrLevels: ["error"],
    })
  : null;
const developmentConsoleTransport =
  !isProduction && !isTest
    ? new winston.transports.Console({
        format: consoleLogFormat,
      })
    : null;

export const logger = winston.createLogger({
  level: logLevel,
  format: jsonLogFormat,
  transports: [
    ...(isProduction ? [] : combinedTransport ? [combinedTransport] : []),
    ...(testTransport ? [testTransport] : []),
    ...(productionConsoleTransport ? [productionConsoleTransport] : []),
    ...(developmentConsoleTransport ? [developmentConsoleTransport] : []),
  ],
});

export const httpLogger = winston.createLogger({
  level: logLevel,
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : isProduction
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "http-requests.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const behaviourLogger = winston.createLogger({
  level: logLevel,
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : isProduction
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "app-behaviour.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const errorLogger = winston.createLogger({
  level: "error",
  format: jsonLogFormat,
  transports: [
    ...(isTest
      ? []
      : isProduction
        ? []
        : [new winston.transports.File({ filename: "errors.log" })]),
    ...(!isProduction && combinedTransport ? [combinedTransport] : []),
    ...(testTransport ? [testTransport] : []),
    ...(productionConsoleTransport ? [productionConsoleTransport] : []),
    ...(developmentConsoleTransport ? [developmentConsoleTransport] : []),
  ],
});

export const detailedRequestLogger = winston.createLogger({
  level: logLevel,
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : isProduction
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "detailed-requests.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const redisLogger = winston.createLogger({
  level: process.env.REDIS_LOG_LEVEL || logLevel,
  format: winston.format.combine(
    attachCorrelationId(),
    attachLogContract(),
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : isProduction
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "redis.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});
