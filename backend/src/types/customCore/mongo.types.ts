import { Types } from "mongoose";

/**
 * Extracts a Mongoose ObjectId from a value of unknown type.
 *
 * This centralizes the Mongoose `_id` boundary cast in one place instead of
 * scattering `as unknown as Types.ObjectId` across the service layer.
 *
 * The function is safe to call after a Mongoose query because `_id` is always
 * an ObjectId instance on a saved document. The branch for strings handles
 * the case where the id comes from a serialized or plain-object representation.
 *
 * @throws {Error} if the value cannot be converted to an ObjectId.
 */
export function toObjectId(id: unknown): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  if (typeof id === "string" && id.length > 0) {
    return new Types.ObjectId(id);
  }
  throw new Error(
    `Cannot convert ${typeof id} to ObjectId: expected an ObjectId instance or a valid 24-character hex string.`,
  );
}

/**
 * Type guard that narrows a value to Types.ObjectId.
 * Useful when you only want to proceed if the value is already an ObjectId.
 */
export function isObjectId(value: unknown): value is Types.ObjectId {
  return value instanceof Types.ObjectId;
}
