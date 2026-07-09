import { UserPublicId, PostPublicId, ImagePublicId } from "@/types/branded";
import { Document } from "mongoose";

export interface INotification extends Document {
  userId: UserPublicId; // receiver publicId
  actionType: string; // like | comment | follow | message | mention
  actorId: UserPublicId; // actor publicId
  actorUsername?: string; // optional, provided by frontend or resolved from actorId
  actorHandle?: string;
  actorAvatar?: string; // actor avatar URL for quick display
  targetId?: PostPublicId | ImagePublicId | UserPublicId; // optional target publicId (e.g., post publicId, image publicId)
  targetType?: string; // 'post' | 'image' | 'user'
  targetPreview?: string; // preview text/snippet of the target content
  idempotencyKey?: string;
  isRead: boolean;
  timestamp: Date;
}

// interface for notification plain object after toJSON()
// all fields optional except the base ones that should always exist
export interface NotificationPlain {
  id?: string;
  _id?: string;
  $__?: unknown;
  userId?: UserPublicId;
  actionType?: string;
  actorId?: UserPublicId;
  actorUsername?: string;
  actorHandle?: string;
  actorAvatar?: string;
  targetId?: PostPublicId | ImagePublicId | UserPublicId;
  targetType?: string;
  targetPreview?: string;
  idempotencyKey?: string;
  isRead?: boolean;
  timestamp?: Date;
}
