import { NotificationPlain } from "@/types/customNotifications/notifications.types";

type UnknownRecord = Record<string, unknown>;

export function normalizeNotificationPlain(value: unknown): NotificationPlain | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as UnknownRecord;
  const plain: NotificationPlain = {};

  const id = raw.id ?? raw._id;
  if (id !== undefined && id !== null) {
    plain.id = String(id);
  }

  if (typeof raw.userId === "string") plain.userId = raw.userId;
  if (typeof raw.actionType === "string") plain.actionType = raw.actionType;
  if (typeof raw.actorId === "string") plain.actorId = raw.actorId;
  if (typeof raw.actorUsername === "string") plain.actorUsername = raw.actorUsername;
  if (typeof raw.actorHandle === "string") plain.actorHandle = raw.actorHandle;
  if (typeof raw.actorAvatar === "string") plain.actorAvatar = raw.actorAvatar;
  if (typeof raw.targetId === "string") plain.targetId = raw.targetId;
  if (typeof raw.targetType === "string") plain.targetType = raw.targetType;
  if (typeof raw.targetPreview === "string") plain.targetPreview = raw.targetPreview;

  if (typeof raw.isRead === "boolean") {
    plain.isRead = raw.isRead;
  } else if (raw.isRead === "1") {
    plain.isRead = true;
  } else if (raw.isRead === "0") {
    plain.isRead = false;
  }

  if (raw.timestamp instanceof Date) {
    plain.timestamp = raw.timestamp;
  } else if (typeof raw.timestamp === "string" || typeof raw.timestamp === "number") {
    const parsedDate = new Date(raw.timestamp);
    if (!Number.isNaN(parsedDate.getTime())) {
      plain.timestamp = parsedDate;
    }
  }

  return plain;
}
