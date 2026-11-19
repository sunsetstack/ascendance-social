import type { NotificationRecord } from "@/types/customNotifications/notifications.types";
import { Types } from "mongoose";
import { asUserPublicId } from "@/types/branded";
import type {
  PostPublicId,
  ImagePublicId,
  UserPublicId,
} from "@/types/branded";

type UnknownRecord = Record<string, unknown>;

export function normalizeNotificationPlain(
  value: unknown,
): NotificationRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const serialized = "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
  if (typeof serialized !== "object" || serialized === null || Array.isArray(serialized)) return null;
  const raw = serialized as UnknownRecord;
  const rawId = raw.id ?? raw._id;
  const id = rawId instanceof Types.ObjectId ? rawId.toHexString() : rawId;
  const timestamp = raw.timestamp instanceof Date ? raw.timestamp :
    typeof raw.timestamp === "string" || typeof raw.timestamp === "number" ? new Date(raw.timestamp) : null;
  const isRead = typeof raw.isRead === "boolean" ? raw.isRead : raw.isRead === "1" ? true : raw.isRead === "0" ? false : null;
  if (typeof id !== "string" || !id.trim() || typeof raw.userId !== "string" || !raw.userId.trim() ||
    typeof raw.actorId !== "string" || !raw.actorId.trim() || typeof raw.actionType !== "string" || !raw.actionType.trim() ||
    isRead === null || !timestamp || Number.isNaN(timestamp.getTime())) return null;
  const plain: NotificationRecord = {
    id, userId: asUserPublicId(raw.userId), actionType: raw.actionType,
    actorId: asUserPublicId(raw.actorId), isRead, timestamp,
  };
  if (typeof raw.actorUsername === "string")
    plain.actorUsername = raw.actorUsername;
  if (typeof raw.actorHandle === "string") plain.actorHandle = raw.actorHandle;
  if (typeof raw.actorAvatar === "string") plain.actorAvatar = raw.actorAvatar;
  if (typeof raw.targetId === "string")
    plain.targetId = raw.targetId as
      | PostPublicId
      | ImagePublicId
      | UserPublicId;
  if (typeof raw.targetType === "string") plain.targetType = raw.targetType;
  if (typeof raw.targetPreview === "string")
    plain.targetPreview = raw.targetPreview;

  return plain;
}

export function requireNotificationRecord(value: unknown): NotificationRecord {
  const record = normalizeNotificationPlain(value);
  if (!record) throw new TypeError("Invalid persisted notification record");
  return record;
}
