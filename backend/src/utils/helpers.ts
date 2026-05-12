import mongoose from "mongoose";
import { errorLogger } from "./winston";

export const convertToObjectId = (id: string): mongoose.Types.ObjectId => {
	return new mongoose.Types.ObjectId(id);
};

export function safeFireAndForget(promise: unknown) {
	Promise.resolve(promise).catch((err) => {
		errorLogger.error("safeFireAndForget error", { err });
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
