import express from "express";
import { errorLogger } from "./winston";

/**
 * Standard error codes for machine-readable error identification.
 * For programmatic error handling on the client side.
 */
export enum ErrorCode {
  // Authentication & Authorization (1xxx)
  INVALID_CREDENTIALS = "AUTH_1001",
  TOKEN_EXPIRED = "AUTH_1002",
  TOKEN_INVALID = "AUTH_1003",
  UNAUTHORIZED = "AUTH_1004",
  FORBIDDEN = "AUTH_1005",
  EMAIL_NOT_VERIFIED = "AUTH_1006",

  // Validation (2xxx)
  VALIDATION_FAILED = "VAL_2001",
  INVALID_INPUT = "VAL_2002",
  REQUIRED_FIELD_MISSING = "VAL_2003",
  INVALID_FORMAT = "VAL_2004",

  // Resource Not Found (3xxx)
  USER_NOT_FOUND = "RES_3001",
  POST_NOT_FOUND = "RES_3002",
  COMMENT_NOT_FOUND = "RES_3003",
  COMMUNITY_NOT_FOUND = "RES_3004",
  IMAGE_NOT_FOUND = "RES_3005",

  // Conflict (4xxx)
  DUPLICATE_EMAIL = "CONF_4001",
  DUPLICATE_HANDLE = "CONF_4002",
  DUPLICATE_RESOURCE = "CONF_4003",
  ALREADY_EXISTS = "CONF_4004",

  // Server Errors (5xxx)
  INTERNAL_ERROR = "SRV_5001",
  DATABASE_ERROR = "SRV_5002",
  STORAGE_ERROR = "SRV_5003",
  TRANSACTION_ERROR = "SRV_5004",
  SERVICE_UNAVAILABLE = "SRV_5005",

  // External Services (6xxx)
  UPLOAD_FAILED = "EXT_6001",
  EMAIL_SEND_FAILED = "EXT_6002",
  EXTERNAL_API_ERROR = "EXT_6003",
}

/**
 * Type-safe context interface for error metadata.
 * Provides structure for debugging information attached to errors.
 */
export interface ErrorContext {
  /** User ID related to the error */
  userId?: string;
  /** Resource ID (post, comment, etc.) */
  resourceId?: string;
  /** Type of resource (post, user, comment, etc.) */
  resourceType?: string;
  /** Operation being performed when error occurred */
  operation?: string;
  /** File where error originated */
  file?: string;
  /** Function where error originated */
  function?: string;
  /** Additional domain-specific context */
  [key: string]: unknown;
}

export interface ErrorOptions {
  context?: ErrorContext;
  cause?: unknown; // Preserves the original stack trace
  errorCode?: ErrorCode; // Machine-readable error code
}

export interface ErrorWithStatusCode extends Error {
  statusCode: number;
}

export interface MongoDBDuplicateKeyError extends Error {
  code: number;
  keyValue: Record<string, unknown>;
}

// type guards for error checking
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function getErrorCode(error: unknown): number | string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number" || typeof code === "string") return code;
  }
  return undefined;
}

export function getErrorLabels(error: unknown): string[] | undefined {
  if (error !== null && typeof error === "object" && "errorLabels" in error) {
    const labels = (error as { errorLabels: unknown }).errorLabels;
    if (Array.isArray(labels)) return labels as string[];
  }
  return undefined;
}

export function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (error !== null && typeof error === "object" && "name" in error) {
    const name = (error as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isNamedError(error: unknown): error is { name: string } {
  return (
    error !== null &&
    typeof error === "object" &&
    typeof (error as Record<string, unknown>).name === "string"
  );
}

export function isErrorWithStatusCode(
  error: unknown,
): error is ErrorWithStatusCode {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error instanceof Error
  );
}

export function isMongoDBDuplicateKeyError(
  error: unknown,
): error is MongoDBDuplicateKeyError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as MongoDBDuplicateKeyError).code === 11000 &&
    "keyValue" in error
  );
}

export class AppError extends Error {
  public statusCode: number;
  public context?: ErrorContext;
  public errorCode?: ErrorCode;

  constructor(
    name: string,
    message: string,
    statusCode: number,
    options?: ErrorOptions,
  ) {
    // Pass the cause to the native Error constructor
    super(message, { cause: options?.cause });
    this.name = name;
    this.statusCode = statusCode;
    this.context = options?.context;
    this.errorCode = options?.errorCode;

    // Capture proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Update your custom errors to accept options instead of completely overriding the constructor
class ValidationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("ValidationError", message, 400, options);
  }
}

class UnauthorizedError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("UnauthorizedError", message, 401, options);
  }
}

class AuthenticationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("AuthenticationError", message, 401, options);
  }
}

class PathError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("PathError", message, 404, options);
  }
}

class NotFoundError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("NotFoundError", message, 404, options);
  }
}

class ForbiddenError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("ForbiddenError", message, 403, options);
  }
}

class SecurityError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("SecurityError", message, 403, options);
  }
}

class DuplicateError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("DuplicateError", message, 409, options);
  }
}

class InternalServerError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("InternalServerError", message, 500, options);
  }
}

class UnknownError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("UnknownError", message, 500, options);
  }
}

class TransactionError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("TransactionError", message, 500, options);
  }
}

class DatabaseError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("DatabaseError", message, 500, options);
  }
}

class UoWError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("UoWError", message, 500, options);
  }
}

class StorageError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("StorageError", message, 500, options);
  }
}

class UploadError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("UploadError", message, 500, options);
  }
}

class FeedError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("FeedError", message, 500, options);
  }
}



class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("ConfigError", message, 500, options);
  }
}

class ConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("ConflictError", message, 409, options);
  }
}

const errorMap = {
  ValidationError,
  UnauthorizedError,
  AuthenticationError,
  PathError,
  NotFoundError,
  ForbiddenError,
  DuplicateError,
  InternalServerError,
  StorageError,
  UploadError,
  FeedError,
  UnknownError,
  TransactionError,
  UoWError,
  DatabaseError,
  SecurityError,
  ConfigError,
  ConflictError,
};

export type ErrorType = keyof typeof errorMap;

export function createError(
  type: ErrorType,
  message: string,
  options?: ErrorOptions,
): AppError {
  const ErrorClass = errorMap[type] || UnknownError;
  return new ErrorClass(message, options);
}

/**
 * Wraps an unknown caught error as an AppError.
 * If the error is already an AppError it is returned unchanged (preserving its type & status code).
 * Otherwise it is wrapped with the given fallback type and the original error attached as `cause`.
 * Strictly for catching unknown errors as it preservers AppError.
 * Using this instead of createError will mask known errors and fuck things up.
 */
export function wrapError(
  error: unknown,
  fallbackType: ErrorType = "InternalServerError",
  options?: Omit<ErrorOptions, "cause">,
): AppError {
  if (error instanceof AppError) return error;
  return createError(fallbackType, getErrorMessage(error), {
    ...options,
    cause: error,
  });
}

export function handleMongoError(error: unknown): never {
  if (error instanceof AppError) throw error;

  if (isMongoDBDuplicateKeyError(error)) {
    throw createError(
      "DuplicateError",
      "Resource already exists (duplicate key).",
      { cause: error },
    );
  }

  if (typeof error === "object" && error !== null && "name" in error) {
    if ((error as Error).name === "ValidationError") {
      throw createError("ValidationError", (error as Error).message, {
        cause: error,
      });
    }
    if ((error as Error).name === "CastError") {
      throw createError(
        "ValidationError",
        "Invalid ID or data format provided.",
        { cause: error },
      );
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  throw createError("DatabaseError", message, { cause: error });
}

/**
 * Type for optional error metrics callback.
 * Use this to integrate with your metrics service.
 */
export type ErrorMetricsCallback = (params: {
  errorType: string;
  statusCode: number;
  endpoint: string;
}) => void;

export class ErrorHandler {
  private static metricsCallback?: ErrorMetricsCallback;

  /**
   * Register a callback for error metrics tracking.
   * @param callback - Function to call with error metrics
   */
  static setMetricsCallback(callback: ErrorMetricsCallback): void {
    ErrorHandler.metricsCallback = callback;
  }

  static handleError(
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): void {
    const appError =
      err instanceof AppError
        ? err
        : createError("UnknownError", getErrorMessage(err), { cause: err });

    // Track metrics if callback is registered
    if (ErrorHandler.metricsCallback) {
      try {
        ErrorHandler.metricsCallback({
          errorType: appError.name,
          statusCode: appError.statusCode || 500,
          endpoint: req.path,
        });
      } catch (metricsError) {
        // Don't let metrics errors break error handling
        errorLogger.error("Failed to track error metrics:", metricsError);
      }
    }

    const response: Record<string, unknown> = {
      type: appError.name,
      message: appError.message,
      code: appError.statusCode || 500,
      ...(appError.errorCode && { errorCode: appError.errorCode }),
    };

    if (appError.context) response.context = appError.context;

    if (process.env.NODE_ENV !== "production") {
      response.stack = appError.stack;
      if (appError.cause instanceof Error) {
        // Expose DB layer stacktrace locally
        response.cause = {
          message: appError.cause.message,
          stack: appError.cause.stack,
        };
      }
    }

    errorLogger.error({
      type: appError.name,
      message: appError.message,
      statusCode: appError.statusCode || 500,
      errorCode: appError.errorCode,
      context: appError.context,
      stack: appError.stack,
      cause: appError.cause,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(appError.statusCode || 500).json({ error: response });
  }
}

/**
 * Standardized error factory with common error patterns.
 * Use these methods for consistent error creation across the application.
 *
 * @example
 * // Validation errors
 * throw Errors.validation("Email is required", { context: { field: "email" } });
 *
 * // Not found errors
 * throw Errors.notFound("User", userId);
 *
 * // Authentication errors
 * throw Errors.unauthorized("Invalid token", ErrorCode.TOKEN_INVALID);
 */
export const Errors = {
  /**
   * Create a validation error (400)
   */
  validation: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("ValidationError", message, {
      errorCode: ErrorCode.VALIDATION_FAILED,
      ...options,
    }),

  /**
   * Create an authentication error (401)
   */
  authentication: (
    message: string = "Authentication required",
    options?: ErrorOptions,
  ): AppError =>
    createError("AuthenticationError", message, {
      errorCode: ErrorCode.UNAUTHORIZED,
      ...options,
    }),

  /**
   * Create an unauthorized error (401)
   */
  unauthorized: (
    message: string = "Unauthorized access",
    options?: ErrorOptions,
  ): AppError =>
    createError("UnauthorizedError", message, {
      errorCode: ErrorCode.UNAUTHORIZED,
      ...options,
    }),

  /**
   * Create a forbidden error (403)
   */
  forbidden: (
    message: string = "Access forbidden",
    options?: ErrorOptions,
  ): AppError =>
    createError("ForbiddenError", message, {
      errorCode: ErrorCode.FORBIDDEN,
      ...options,
    }),

  /**
   * Create a not found error (404)
   * @param resourceType - Type of resource (e.g., "User", "Post")
   * @param identifier - Resource identifier
   */
  notFound: (
    resourceType: string,
    identifier?: string,
    options?: ErrorOptions,
  ): AppError => {
    const message = identifier
      ? `${resourceType} with ID '${identifier}' not found`
      : `${resourceType} not found`;
    return createError("NotFoundError", message, {
      context: { resourceType, resourceId: identifier },
      ...options,
    });
  },

  /**
   * Create a conflict/duplicate error (409)
   */
  conflict: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("ConflictError", message, {
      errorCode: ErrorCode.ALREADY_EXISTS,
      ...options,
    }),

  /**
   * Create a duplicate error (409)
   */
  duplicate: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("DuplicateError", message, {
      errorCode: ErrorCode.DUPLICATE_RESOURCE,
      ...options,
    }),

  /**
   * Create a database error (500)
   */
  database: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("DatabaseError", message, {
      errorCode: ErrorCode.DATABASE_ERROR,
      ...options,
    }),

  /**
   * Create a storage error (500)
   */
  storage: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("StorageError", message, {
      errorCode: ErrorCode.STORAGE_ERROR,
      ...options,
    }),

  /**
   * Create an upload error (500)
   */
  upload: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("UploadError", message, {
      errorCode: ErrorCode.UPLOAD_FAILED,
      ...options,
    }),

  /**
   * Create an internal server error (500)
   */
  internal: (
    message: string = "Internal server error",
    options?: ErrorOptions,
  ): AppError =>
    createError("InternalServerError", message, {
      errorCode: ErrorCode.INTERNAL_ERROR,
      ...options,
    }),

  /**
   * Create a transaction error (500)
   */
  transaction: (
    message: string,
    options?: ErrorOptions,
  ): AppError =>
    createError("TransactionError", message, {
      errorCode: ErrorCode.TRANSACTION_ERROR,
      ...options,
    }),

  /**
   * Create a security error (403)
   */
  security: (message: string, options?: ErrorOptions): AppError =>
    createError("SecurityError", message, {
      errorCode: ErrorCode.FORBIDDEN,
      ...options,
    }),

  /**
   * Create a configuration error (500)
   */
  config: (message: string, options?: ErrorOptions): AppError =>
    createError("ConfigError", message, {
      errorCode: ErrorCode.INTERNAL_ERROR,
      ...options,
    }),
};
