import { UserPublicId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";

// Event triggered when a cold start feed is generated for a user
export class ColdStartFeedGeneratedEvent implements IEvent {
  readonly type = "ColdStartFeedGenerated";
  readonly timestamp: Date = new Date();

  constructor(public readonly userId: UserPublicId) {}
}
