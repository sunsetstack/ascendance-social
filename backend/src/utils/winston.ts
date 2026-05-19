import winston from "winston";
import { getCorrelationId } from "@/runtime/request-context";

const attachCorrelationId = winston.format((info) => {
  const correlationId = getCorrelationId();
  if (correlationId && info.correlationId === undefined) {
    info.correlationId = correlationId;
  }

  return info;
});

const jsonLogFormat = winston.format.combine(
  attachCorrelationId(),
  winston.format.timestamp(),
  winston.format.json(),
);

const consoleLogFormat = winston.format.combine(
  attachCorrelationId(),
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(
    ({ timestamp, level, message, correlationId, ...meta }) => {
      const correlation =
        typeof correlationId === "string" ? ` [${correlationId}]` : "";
      const metaStr = Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : "";
      return `[${timestamp}]${correlation} ${level}: ${message}${metaStr}`;
    },
  ),
);

const isTest = process.env.NODE_ENV === "test";
const testTransport = isTest
  ? new winston.transports.Console({ silent: true })
  : null;
const combinedTransport = isTest
  ? null
  : new winston.transports.File({ filename: "app.log" });

export const logger = winston.createLogger({
  level: "info",
  format: jsonLogFormat,
  transports: [
    ...(combinedTransport ? [combinedTransport] : []),
    ...(testTransport ? [testTransport] : []),
    ...(process.env.NODE_ENV !== "production" && !isTest
      ? [
          new winston.transports.Console({
            format: consoleLogFormat,
          }),
        ]
      : []),
  ],
});

export const httpLogger = winston.createLogger({
  level: "info",
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : [
        new winston.transports.File({ filename: "http-requests.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const behaviourLogger = winston.createLogger({
  level: "info",
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
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
      : [new winston.transports.File({ filename: "errors.log" })]),
    ...(combinedTransport ? [combinedTransport] : []),
    ...(testTransport ? [testTransport] : []),
    // Also log to console in development
    ...(process.env.NODE_ENV !== "production" && !isTest
      ? [
          new winston.transports.Console({
            format: consoleLogFormat,
          }),
        ]
      : []),
  ],
});

export const detailedRequestLogger = winston.createLogger({
  level: "info",
  format: jsonLogFormat,
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : [
        new winston.transports.File({ filename: "detailed-requests.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const redisLogger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    attachCorrelationId(),
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(
      ({ timestamp, level, message, correlationId, ...meta }) => {
        const correlation =
          typeof correlationId === "string" ? ` [${correlationId}]` : "";
        const metaStr = Object.keys(meta).length
          ? JSON.stringify(meta, null, 2)
          : "";
        return `[${timestamp}] [REDIS]${correlation} ${level}: ${message} ${metaStr}`;
      },
    ),
  ),
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : [
        new winston.transports.File({ filename: "redis.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});
