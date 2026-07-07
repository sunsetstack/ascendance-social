import { Server as SocketIOServer } from "socket.io";
import { injectable } from "tsyringe";
import { IRealtimeMessageHandler } from "./IRealtimeMessageHandler.interface";
import { FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { logger } from "@/utils/winston";
import { EventRegistry } from "@/application/common/events/event-registry";

@injectable()
export class GlobalNewPostMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.newPostGlobal;

  async handle(io: SocketIOServer, message: FeedUpdateMessage): Promise<void> {
    const postId = message.postId ?? message.imageId;
    if (!postId) return;

    logger.info(
      `Skipping global new post notification for post ${postId} - lazy refresh strategy enabled`,
    );
  }
}
