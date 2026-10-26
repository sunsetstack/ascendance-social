import winston from "winston";
import os from "node:os";
import { getCorrelationId, getRequestContext } from "@/runtime/request-context";
import {
  isSensitiveKey,
  redactSensitiveText,
  serializeError,
} from "./error-serialization";

export const MAX_LOG_ROOT_MESSAGE_LENGTH = 8_192;
export const MAX_LOG_STRING_LENGTH = 4_096;
export const MAX_LOG_ARRAY_ITEMS = 100;
export const MAX_LOG_OBJECT_ENTRIES = 100;
export const MAX_LOG_METADATA_DEPTH = 4;

const CIRCULAR_MARKER = "[Circular]";
const MAX_DEPTH_MARKER = "[MaxDepth]";
const REDACTED_MARKER = "[REDACTED]";
const TRUNCATED_MARKER = "[Truncated]";
const UNSERIALIZABLE_MARKER = "[Unserializable]";

type PropertyRead = { ok: true; value: unknown } | { ok: false };

function readProperty(value: object, key: PropertyKey): PropertyRead {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

function defineOwnedProperty(
  value: object,
  key: PropertyKey,
  propertyValue: unknown,
): boolean {
  try {
    Object.defineProperty(value, key, {
      configurable: true,
      enumerable: true,
      value: propertyValue,
      writable: true,
    });
    return true;
  } catch {
    return false;
  }
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - TRUNCATED_MARKER.length)}${TRUNCATED_MARKER}`;
}

function sanitizeText(value: string, limit: number): string {
  try {
    return truncateText(redactSensitiveText(value), limit);
  } catch {
    return UNSERIALIZABLE_MARKER;
  }
}

function isErrorValue(value: unknown): boolean | undefined {
  try {
    return value instanceof Error;
  } catch {
    return undefined;
  }
}

function isArrayValue(value: unknown): boolean | undefined {
  try {
    return Array.isArray(value);
  } catch {
    return undefined;
  }
}

function objectKeys(value: object): string[] | undefined {
  try {
    return Object.keys(value);
  } catch {
    return undefined;
  }
}

function hasSensitiveKey(key: string): boolean {
  try {
    return isSensitiveKey(key);
  } catch {
    return true;
  }
}

function safePrimitiveString(value: bigint | symbol): string {
  try {
    return sanitizeText(String(value), MAX_LOG_STRING_LENGTH);
  } catch {
    return UNSERIALIZABLE_MARKER;
  }
}

function markTruncated(value: Record<string, unknown>): void {
  defineOwnedProperty(value, TRUNCATED_MARKER, true);
}

function setSanitizedEntry(
  value: Record<string, unknown>,
  key: string,
  entryValue: unknown,
): void {
  defineOwnedProperty(value, key, entryValue);
}

function isCircular(value: object, seen: WeakSet<object>): boolean | undefined {
  try {
    return seen.has(value);
  } catch {
    return undefined;
  }
}

function trackValue(value: object, seen: WeakSet<object>): boolean {
  try {
    seen.add(value);
    return true;
  } catch {
    return false;
  }
}

function untrackValue(value: object, seen: WeakSet<object>): void {
  try {
    seen.delete(value);
  } catch {
    // The sanitizer can still return the already-built copy.
  }
}

function sanitizeArray(
  value: unknown[],
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const lengthValue = readProperty(value, "length");
  if (
    !lengthValue.ok ||
    typeof lengthValue.value !== "number" ||
    !Number.isSafeInteger(lengthValue.value) ||
    lengthValue.value < 0
  ) {
    return UNSERIALIZABLE_MARKER;
  }

  const circular = isCircular(value, seen);
  if (circular === undefined) {
    return UNSERIALIZABLE_MARKER;
  }
  if (circular) {
    return CIRCULAR_MARKER;
  }
  if (!trackValue(value, seen)) {
    return UNSERIALIZABLE_MARKER;
  }

  try {
    const sanitized: unknown[] = [];
    const itemCount = Math.min(lengthValue.value, MAX_LOG_ARRAY_ITEMS);

    for (let index = 0; index < itemCount; index += 1) {
      const item = readProperty(value, index);
      sanitized.push(
        item.ok
          ? sanitizeLogValue(item.value, depth + 1, seen)
          : UNSERIALIZABLE_MARKER,
      );
    }

    if (lengthValue.value > MAX_LOG_ARRAY_ITEMS) {
      sanitized.push(TRUNCATED_MARKER);
    }

    return sanitized;
  } catch {
    return UNSERIALIZABLE_MARKER;
  } finally {
    untrackValue(value, seen);
  }
}

function sanitizeObject(
  value: object,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const circular = isCircular(value, seen);
  if (circular === undefined) {
    return UNSERIALIZABLE_MARKER;
  }
  if (circular) {
    return CIRCULAR_MARKER;
  }
  if (!trackValue(value, seen)) {
    return UNSERIALIZABLE_MARKER;
  }

  try {
    const keys = objectKeys(value);
    if (!keys) {
      return UNSERIALIZABLE_MARKER;
    }

    const sanitized: Record<string, unknown> = {};
    const entryCount = Math.min(keys.length, MAX_LOG_OBJECT_ENTRIES);

    for (let index = 0; index < entryCount; index += 1) {
      const key = keys[index];
      const sensitive = hasSensitiveKey(key);
      if (sensitive) {
        setSanitizedEntry(sanitized, key, REDACTED_MARKER);
        continue;
      }

      const childValue = readProperty(value, key);
      setSanitizedEntry(
        sanitized,
        key,
        childValue.ok
          ? sanitizeLogValue(childValue.value, depth + 1, seen)
          : UNSERIALIZABLE_MARKER,
      );
    }

    if (keys.length > MAX_LOG_OBJECT_ENTRIES) {
      markTruncated(sanitized);
    }

    return sanitized;
  } catch {
    return UNSERIALIZABLE_MARKER;
  } finally {
    untrackValue(value, seen);
  }
}

export function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  const error = isErrorValue(value);
  if (error === undefined) {
    return UNSERIALIZABLE_MARKER;
  }
  if (error) {
    try {
      return serializeError(value as Error);
    } catch {
      return UNSERIALIZABLE_MARKER;
    }
  }

  if (typeof value === "string") {
    return sanitizeText(value, MAX_LOG_STRING_LENGTH);
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return safePrimitiveString(value);
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_LOG_METADATA_DEPTH) {
    return MAX_DEPTH_MARKER;
  }

  const array = isArrayValue(value);
  if (array === undefined) {
    return UNSERIALIZABLE_MARKER;
  }
  if (array) {
    return sanitizeArray(value as unknown[], depth, seen);
  }

  return sanitizeObject(value, depth, seen);
}

function safeHostname(): string {
  try {
    return os.hostname();
  } catch {
    return UNSERIALIZABLE_MARKER;
  }
}

const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_LOG_MESSAGE = "[Unserializable]";
const WINSTON_LEVEL_SYMBOL = Symbol.for("level");
const WINSTON_MESSAGE_SYMBOL = Symbol.for("message");
const WINSTON_SPLAT_SYMBOL = Symbol.for("splat");
const PRESERVED_ENVELOPE_KEYS = [
  "event",
  "service",
  "correlationId",
  "operationId",
  "errorId",
  "timestamp",
] as const;

type SafeLogInfo = Record<string | symbol, unknown>;

function safeJsonText(value: unknown, limit: number): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? sanitizeText(serialized, limit)
      : UNSERIALIZABLE_MARKER;
  } catch {
    return UNSERIALIZABLE_MARKER;
  }
}

function sanitizeRootMessage(value: unknown): {
  error?: unknown;
  message: string;
} {
  const error = isErrorValue(value);
  if (error === undefined) {
    return { message: DEFAULT_LOG_MESSAGE };
  }
  if (error) {
    try {
      const serialized = serializeError(value as Error);
      return {
        error: serialized,
        message: sanitizeText(
          serialized.message || "Error",
          MAX_LOG_ROOT_MESSAGE_LENGTH,
        ),
      };
    } catch {
      return { message: DEFAULT_LOG_MESSAGE };
    }
  }

  if (typeof value === "string") {
    return { message: sanitizeText(value, MAX_LOG_ROOT_MESSAGE_LENGTH) };
  }

  const sanitized = sanitizeLogValue(value);
  if (typeof sanitized === "string") {
    return { message: sanitizeText(sanitized, MAX_LOG_ROOT_MESSAGE_LENGTH) };
  }
  if (sanitized === undefined) {
    return { message: "[Undefined]" };
  }
  if (sanitized === null) {
    return { message: "null" };
  }
  if (typeof sanitized === "number" || typeof sanitized === "boolean") {
    try {
      return {
        message: sanitizeText(
          String(sanitized),
          MAX_LOG_ROOT_MESSAGE_LENGTH,
        ),
      };
    } catch {
      return { message: DEFAULT_LOG_MESSAGE };
    }
  }

  return { message: safeJsonText(sanitized, MAX_LOG_ROOT_MESSAGE_LENGTH) };
}

function createDefaultLogInfo(): SafeLogInfo {
  return {
    env: process.env.NODE_ENV ?? "development",
    host: safeHostname(),
    level: DEFAULT_LOG_LEVEL,
    message: DEFAULT_LOG_MESSAGE,
    pid: process.pid,
    service: process.env.SERVICE_NAME ?? "ascendance-backend",
  };
}

function createMinimalLogInfo(): SafeLogInfo {
  const target = createDefaultLogInfo();
  defineOwnedProperty(target, UNSERIALIZABLE_MARKER, true);
  defineOwnedProperty(target, WINSTON_LEVEL_SYMBOL, target.level);
  return target;
}

function copyRequiredWinstonSymbols(source: object, target: SafeLogInfo): void {
  const level = readProperty(source, WINSTON_LEVEL_SYMBOL);
  defineOwnedProperty(
    target,
    WINSTON_LEVEL_SYMBOL,
    level.ok && typeof level.value === "string"
      ? sanitizeText(level.value, MAX_LOG_STRING_LENGTH)
      : target.level,
  );

  const message = readProperty(source, WINSTON_MESSAGE_SYMBOL);
  if (message.ok && typeof message.value === "string") {
    defineOwnedProperty(
      target,
      WINSTON_MESSAGE_SYMBOL,
      sanitizeText(message.value, MAX_LOG_ROOT_MESSAGE_LENGTH),
    );
  }

  const splat = readProperty(source, WINSTON_SPLAT_SYMBOL);
  if (splat.ok) {
    defineOwnedProperty(target, WINSTON_SPLAT_SYMBOL, splat.value);
  }
}

function copyEnvelopeField(
  source: object,
  target: SafeLogInfo,
  key: string,
): void {
  if (hasSensitiveKey(key)) {
    defineOwnedProperty(target, key, REDACTED_MARKER);
    return;
  }

  const value = readProperty(source, key);
  defineOwnedProperty(
    target,
    key,
    value.ok ? sanitizeLogValue(value.value) : UNSERIALIZABLE_MARKER,
  );
}

function createSafeLogInfo(source: object): SafeLogInfo {
  const target = createDefaultLogInfo();
  const level = readProperty(source, "level");
  if (level.ok && typeof level.value === "string") {
    defineOwnedProperty(
      target,
      "level",
      sanitizeText(level.value, MAX_LOG_STRING_LENGTH),
    );
  }

  const rootMessage = readProperty(source, "message");
  const sanitizedMessage = rootMessage.ok
    ? sanitizeRootMessage(rootMessage.value)
    : { message: DEFAULT_LOG_MESSAGE };
  defineOwnedProperty(target, "message", sanitizedMessage.message);
  if (sanitizedMessage.error !== undefined) {
    defineOwnedProperty(target, "error", sanitizedMessage.error);
  }

  const keys = objectKeys(source);
  if (!keys) {
    defineOwnedProperty(target, UNSERIALIZABLE_MARKER, true);
    copyRequiredWinstonSymbols(source, target);
    return target;
  }

  const handledKeys = new Set<string>(["level", "message"]);
  if (sanitizedMessage.error !== undefined) {
    handledKeys.add("error");
  }

  for (const key of PRESERVED_ENVELOPE_KEYS) {
    if (keys.includes(key)) {
      copyEnvelopeField(source, target, key);
      handledKeys.add(key);
    }
  }

  let copiedEntries = 0;
  for (const key of keys) {
    if (handledKeys.has(key)) {
      continue;
    }
    if (copiedEntries >= MAX_LOG_OBJECT_ENTRIES) {
      markTruncated(target);
      break;
    }

    copyEnvelopeField(source, target, key);
    copiedEntries += 1;
  }

  copyRequiredWinstonSymbols(source, target);
  return target;
}

const attachLogContract = winston.format((info) => {
  try {
    return createSafeLogInfo(info) as typeof info;
  } catch {
    return createMinimalLogInfo() as typeof info;
  }
});

export function createLogContractFormat() {
  return attachLogContract();
}

function requestContextValue(
  requestContext: object | undefined,
  key: string,
): unknown {
  if (!requestContext) {
    return undefined;
  }

  const value = readProperty(requestContext, key);
  return value.ok ? value.value : undefined;
}

function hasOwnProperty(value: object | undefined, key: string): boolean {
  if (!value) {
    return false;
  }

  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch {
    return false;
  }
}

function attachIfMissing(
  info: object,
  key: string,
  getValue: () => unknown,
): void {
  if (hasSensitiveKey(key)) {
    defineOwnedProperty(info, key, REDACTED_MARKER);
    return;
  }

  const existingValue = readProperty(info, key);
  if (existingValue.ok && existingValue.value !== undefined) {
    return;
  }

  const value = getValue();
  if (!value) {
    return;
  }

  defineOwnedProperty(info, key, sanitizeLogValue(value));
}

const attachCorrelationId = winston.format((info) => {
  try {
    let requestContext: object | undefined;
    try {
      requestContext = getRequestContext() as object | undefined;
    } catch {
      requestContext = undefined;
    }

    let fallbackCorrelationId: unknown;
    try {
      fallbackCorrelationId = getCorrelationId();
    } catch {
      fallbackCorrelationId = undefined;
    }

    attachIfMissing(
      info,
      "correlationId",
      () =>
        requestContextValue(requestContext, "correlationId") ??
        fallbackCorrelationId,
    );
    if (hasOwnProperty(requestContext, "userId")) {
      attachIfMissing(info, "userId", () =>
        requestContextValue(requestContext, "userId"),
      );
    }
    for (const key of ["clientRequestId", "causedByClientRequestId"]) {
      if (hasOwnProperty(requestContext, key)) {
        attachIfMissing(info, key, () => requestContextValue(requestContext, key));
      }
    }
  } catch {
    // The contract formatter has already produced a safe envelope.
  }

  return info;
});

function safeConsoleText(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return sanitizeText(value, MAX_LOG_ROOT_MESSAGE_LENGTH);
  }

  const message = sanitizeRootMessage(value).message;
  return message || fallback;
}

function readValueOrUndefined(info: object, key: PropertyKey): unknown {
  const value = readProperty(info, key);
  return value.ok ? value.value : undefined;
}

function formatConsoleLog(info: object): string {
  try {
    const timestamp = safeConsoleText(
      readValueOrUndefined(info, "timestamp"),
      "unknown-time",
    );
    const level = safeConsoleText(
      readValueOrUndefined(info, "level"),
      DEFAULT_LOG_LEVEL,
    );
    const message = safeConsoleText(
      readValueOrUndefined(info, "message"),
      DEFAULT_LOG_MESSAGE,
    );
    const correlationId = readProperty(info, "correlationId");
    const event = readProperty(info, "event");
    const correlation = correlationId.ok && typeof correlationId.value === "string"
      ? ` [${sanitizeText(correlationId.value, MAX_LOG_STRING_LENGTH)}]`
      : "";
    const eventName = event.ok && typeof event.value === "string"
      ? ` ${sanitizeText(event.value, MAX_LOG_STRING_LENGTH)}`
      : "";
    const meta: Record<string, unknown> = {};
    const keys = objectKeys(info);
    if (!keys) {
      return `[${timestamp}]${correlation}${eventName} ${level}: ${message} ${UNSERIALIZABLE_MARKER}`;
    }

    for (const key of keys) {
      if (
        key === "timestamp" ||
        key === "level" ||
        key === "message" ||
        key === "event" ||
        key === "correlationId"
      ) {
        continue;
      }

      if (hasSensitiveKey(key)) {
        setSanitizedEntry(meta, key, REDACTED_MARKER);
        continue;
      }

      const value = readProperty(info, key);
      setSanitizedEntry(
        meta,
        key,
        value.ok ? sanitizeLogValue(value.value) : UNSERIALIZABLE_MARKER,
      );
    }

    const metaText = Object.keys(meta).length
      ? ` ${safeJsonText(meta, MAX_LOG_ROOT_MESSAGE_LENGTH)}`
      : "";
    return `[${timestamp}]${correlation}${eventName} ${level}: ${message}${metaText}`;
  } catch {
    return `[unknown-time] ${DEFAULT_LOG_LEVEL}: ${DEFAULT_LOG_MESSAGE}`;
  }
}

export function createJsonLogFormat() {
  return winston.format.combine(
    createLogContractFormat(),
    attachCorrelationId(),
    winston.format.timestamp(),
    winston.format.json(),
  );
}

export function createConsoleLogFormat() {
  return winston.format.combine(
    createLogContractFormat(),
    attachCorrelationId(),
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf((info) => formatConsoleLog(info)),
  );
}

const jsonLogFormat = createJsonLogFormat();
const consoleLogFormat = createConsoleLogFormat();

const isTest = process.env.NODE_ENV === "test";
const useJsonConsole = process.env.NODE_ENV === "production" || process.env.LOG_OUTPUT === "stdout";
const logLevel = process.env.LOG_LEVEL || "info";
const testTransport = isTest
  ? new winston.transports.Console({ silent: true })
  : null;
const combinedTransport = isTest || useJsonConsole
  ? null
  : new winston.transports.File({ filename: "app.log" });
const productionConsoleTransport = useJsonConsole && !isTest
  ? new winston.transports.Console({
      stderrLevels: ["error"],
    })
  : null;
const developmentConsoleTransport =
  !useJsonConsole && !isTest
    ? new winston.transports.Console({
        format: consoleLogFormat,
      })
    : null;

export const logger = winston.createLogger({
  level: logLevel,
  format: jsonLogFormat,
  transports: [
    ...(useJsonConsole ? [] : combinedTransport ? [combinedTransport] : []),
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
    : useJsonConsole
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
    : useJsonConsole
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
      : useJsonConsole
        ? []
        : [new winston.transports.File({ filename: "errors.log" })]),
    ...(!useJsonConsole && combinedTransport ? [combinedTransport] : []),
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
    : useJsonConsole
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "detailed-requests.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});

export const redisLogger = winston.createLogger({
  level: process.env.REDIS_LOG_LEVEL || logLevel,
  format: createJsonLogFormat(),
  transports: isTest
    ? [...(testTransport ? [testTransport] : [])]
    : useJsonConsole
      ? [...(productionConsoleTransport ? [productionConsoleTransport] : [])]
    : [
        new winston.transports.File({ filename: "redis.log" }),
        ...(combinedTransport ? [combinedTransport] : []),
      ],
});
