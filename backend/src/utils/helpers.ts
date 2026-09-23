import mongoose from "mongoose";
import { container } from "tsyringe";
import type { ForensicOperationalErrorService } from "@/services/forensic-operational-error.service";
import { TOKENS } from "@/types/tokens";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { serializeError } from "@/utils/error-serialization";
import { errorLogger } from "./winston";

export const convertToObjectId = (id: string): mongoose.Types.ObjectId => {
	return new mongoose.Types.ObjectId(id);
};

export function safeFireAndForget(promise: unknown): void {
	Promise.resolve(promise).catch((err) => {
		const errorId = logNonHttpTerminalError(err, {
			message: "safeFireAndForget error",
			event: "safe_fire_and_forget.error",
			operation: "safeFireAndForget",
		});

		try {
			const forensicWriter = container.resolve<ForensicOperationalErrorService>(
				TOKENS.Services.ForensicOperationalError,
			);
			void forensicWriter.record(err, {
				errorId,
				operation: "safeFireAndForget",
			});
		} catch (forensicWriterError) {
			errorLogger.error({
				message: "Forensic operational error writer unavailable",
				event: "forensic_operational_error.unavailable",
				errorId,
				error: serializeError(forensicWriterError),
			});
		}
	});
}

export function generateSlug(input: string, maxLength?: number): string {
	let slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	if (maxLength) {
		slug = slug.slice(0, maxLength);
	}
	return slug;
}

/**
 * Exhaustiveness check for Discriminated Unions.
 * Throws a runtime error if code reaches an unhandled path.
 * A compile time error is thrown if TS detects a path was missed.
 */
export function assertNever(x: never): never {
	throw new Error("Unhandled case: " + JSON.stringify(x));
}
