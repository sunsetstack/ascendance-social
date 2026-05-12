import { validate as uuidValidate, version as uuidVersion } from "uuid";
import mongoose from "mongoose";
import sanitizeHtml from "sanitize-html";
import { Errors } from "@/utils/errors";

/**
 * Sanitizes objects for Mongo by removing dangerous keys that could enable NoSQL injection
 * Also strips prototype pollution keys and removes keys with empty object values
 */
export function sanitizeForMongo<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(sanitizeForMongo) as T;

  // preserve Mongo objIDs
  if (input instanceof mongoose.Types.ObjectId) return input;

  if (typeof input !== "object") return input; // strings/numbers/booleans are safe

  const out: Record<string, unknown> = {};
  const dangerousKeys = ["__proto__", "constructor", "prototype"];
  const source = input as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    // drop NoSQL injection operators and path traversal
    if (key.startsWith("$") || key.includes(".")) {
      continue;
    }
    // drop prototype pollution keys
    if (dangerousKeys.includes(key)) {
      continue;
    }

    const sanitizedValue = sanitizeForMongo(source[key]);

    // skip keys with empty object values (result of sanitizing nested malicious objects)
    if (
      typeof sanitizedValue === "object" &&
      sanitizedValue !== null &&
      !(sanitizedValue instanceof mongoose.Types.ObjectId) &&
      !Array.isArray(sanitizedValue) &&
      Object.keys(sanitizedValue).length === 0
    ) {
      continue;
    }

    out[key] = sanitizedValue;
  }
  return out as T;
}

/**
 * Validates UUID v4 format for publicIds
 */
export function isValidPublicId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  // validate + check it's specifically version 4
  return uuidValidate(id) && uuidVersion(id) === 4;
}

/**
 * Sanitizes HTML content to prevent XSS attacks
 * Strips all HTML tags and attributes
 */
export const sanitize = (text: string): string =>
  sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates and sanitizes text input with length constraints
 */
export function sanitizeTextInput(
  input: unknown,
  options: { maxLength?: number; allowEmpty?: boolean } | number = 5000,
): string {
  const maxLength =
    typeof options === "number" ? options : (options.maxLength ?? 5000);
  const allowEmpty = typeof options === "object" ? !!options.allowEmpty : false;

  if (typeof input !== "string") {
    throw Errors.validation("Input must be a string");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    if (allowEmpty) return "";
    throw Errors.validation("Input cannot be empty");
  }

  if (trimmed.length > maxLength) {
    throw Errors.validation(`Input cannot exceed ${maxLength} characters`);
  }

  const sanitized = sanitize(trimmed);
  if (sanitized.length === 0) {
    if (allowEmpty) return "";
    throw Errors.validation("Input is empty after sanitization");
  }

  return sanitized;
}
