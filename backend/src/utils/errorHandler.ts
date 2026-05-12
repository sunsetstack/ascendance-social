import { errorLogger } from "./winston";
import { getErrorMessage } from "./errors";

/**
 * Wrapper to catch and log errors in async functions
 * Usage:
 * const result = await withErrorLogging(someAsyncFunction, 'ContextName');
 * Example: 
 * async createUser(data: any) {
    return withErrorLogging(
      async () => {
        // actual logic here
				return user;
      },
      "UserService.createUser"
    );
  }
 */
export async function withErrorLogging<T>(fn: () => Promise<T>, context: string): Promise<T> {
	try {
		return await fn();
	} catch (error: unknown) {
		errorLogger.error({
			context,
			message: getErrorMessage(error),
			stack: error instanceof Error ? error.stack : undefined,
			timestamp: new Date().toISOString(),
		});
		throw error; // Re-throw to let caller handle it
	}
}

/**
 * Wrapper for sync functions
 */
export function withErrorLoggingSync<T>(fn: () => T, context: string): T {
	try {
		return fn();
	} catch (error: unknown) {
		errorLogger.error({
			context,
			message: getErrorMessage(error),
			stack: error instanceof Error ? error.stack : undefined,
			timestamp: new Date().toISOString(),
		});
		throw error;
	}
}

/**
 * Log error without re-throwing (for fire-and-forget operations)
 */
export function logError(error: unknown, context: string, additionalInfo?: unknown): void {
	errorLogger.error({
		context,
		message: getErrorMessage(error),
		stack: error instanceof Error ? error.stack : undefined,
		additionalInfo,
		timestamp: new Date().toISOString(),
	});
}
