import { UserPublicId, PostPublicId, ImagePublicId, MongoId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";

export interface NotificationPayload {
	receiverId: UserPublicId;
	actionType: string;
	actorId: UserPublicId;
	actorUsername?: string;
	actorHandle?: string;
	actorAvatar?: string;
	targetId?: PostPublicId | ImagePublicId | UserPublicId | MongoId;
	targetType?: string;
	targetPreview?: string;
}

export class NotificationRequestedEvent implements IEvent {
	readonly type = "NotificationRequestedEvent";
	readonly timestamp: Date = new Date();

	constructor(public readonly payload: NotificationPayload) {}
}
