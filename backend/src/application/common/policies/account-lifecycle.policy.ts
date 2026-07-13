import { createHash } from "node:crypto";

export const DELETED_ACCOUNT_COMMENT = "This user no-longer exists";

export const BANNED_ACCOUNT_COMMENT =
  "This comment was removed because the user was banned";

export const UNAVAILABLE_MESSAGE_SENDER =
  "User is on a vacation. Don't expect a reply soon";

export const DEFAULT_ACCOUNT_AVATAR =
  "https://res.cloudinary.com/dfyqaqnj7/image/upload/v1737562142/defaultAvatar_evsmmj.jpg";

export type AccountLifecycleAction = "ban" | "delete";

export function accountLifecycleKey(userPublicId: string): string {
  return createHash("sha256").update(userPublicId).digest("hex");
}

export function commentTombstoneFor(action: AccountLifecycleAction): string {
  return action === "delete" ? DELETED_ACCOUNT_COMMENT : BANNED_ACCOUNT_COMMENT;
}
