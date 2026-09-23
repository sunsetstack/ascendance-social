import mongoose from "mongoose";
import {
  AppError,
  isAppError,
  isMongoDBDuplicateKeyError,
  ErrorContext,
  ErrorCode,
} from "@/utils/errors";

/**
 * Domain-specific errors for Post operations.
 * These extend the base AppError with domain context and error codes.
 */

export class PostNotFoundError extends AppError {
  constructor(message = "Post not found", context?: ErrorContext) {
    super("PostNotFoundError", message, 404, {
      context: { ...context, resourceType: "Post" },
      errorCode: ErrorCode.POST_NOT_FOUND,
    });
  }
}

export class PostAuthorizationError extends AppError {
  constructor(
    message = "You do not have permission to perform this action",
    context?: ErrorContext,
  ) {
    super("PostAuthorizationError", message, 403, {
      context: { ...context, resourceType: "Post" },
      errorCode: ErrorCode.FORBIDDEN,
    });
  }
}

export class UserNotFoundError extends AppError {
  constructor(message = "User not found", context?: ErrorContext) {
    super("UserNotFoundError", message, 404, {
      context: { ...context, resourceType: "User" },
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
  }
}

export class PostConflictError extends AppError {
  constructor(message = "Post already exists", context?: ErrorContext) {
    super("PostConflictError", message, 409, {
      context: { ...context, resourceType: "Post" },
      errorCode: ErrorCode.ALREADY_EXISTS,
    });
  }
}

export class PostPersistenceError extends AppError {
  constructor(
    message = "Failed to persist post",
    context?: ErrorContext,
    cause?: unknown,
  ) {
    super("PostPersistenceError", message, 500, {
      context: { ...context, resourceType: "Post" },
      errorCode: ErrorCode.DATABASE_ERROR,
      cause,
    });
  }
}

/**
 * Maps unknown errors to appropriate Post domain errors.
 * Preserves AppError instances and wraps database errors with domain context.
 * 
 * @param error - The caught error
 * @param context - Additional context to attach
 * @returns Mapped AppError with domain context
 */
export function mapPostError(
  error: unknown,
  context: ErrorContext = {},
): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (isMongoDBDuplicateKeyError(error)) {
    return new PostConflictError("Post already exists", {
      ...context,
      keyValue: error.keyValue,
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return new PostPersistenceError(
      error.message,
      {
        ...context,
        cause: "validation",
      },
      error,
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return new PostPersistenceError(
      error.message,
      {
        ...context,
        cause: "cast",
      },
      error,
    );
  }

  if (error instanceof Error) {
    return new PostPersistenceError(
      error.message,
      {
        ...context,
        errorName: error.name,
      },
      error,
    );
  }

  return new PostPersistenceError("Unexpected post persistence error", context);
}
