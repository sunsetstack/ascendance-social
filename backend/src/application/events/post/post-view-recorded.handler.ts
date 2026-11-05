import { injectable } from "tsyringe";
import type { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import type { PostViewRecordedEvent } from "./post.event";

@injectable()
export class PostViewRecordedHandler implements IEventHandler<PostViewRecordedEvent> {
  // Acknowledge legacy refresh events; feed counters are now read from MongoDB.
  async handle(_event: PostViewRecordedEvent): Promise<void> {}
}
