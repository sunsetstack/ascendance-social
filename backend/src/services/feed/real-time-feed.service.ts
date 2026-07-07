import { inject, injectable } from "tsyringe";
import { RedisService } from "../redis.service";
import { WebSocketServer } from "../../server/socketServer";
import { IRealtimeMessageHandler } from "@/application/handlers/realtime/IRealtimeMessageHandler.interface";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import {
  EventRegistry,
  RealtimeMessageType,
  SocketServerEventName,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

export interface FeedUpdateMessage {
  type: RealtimeMessageType;
  eventId?: string;
  userId?: string;
  uploaderId?: string;
  imageId?: string;
  postId?: string;
  authorId?: string;
  targetId?: string;
  actionType?: string;
  tags?: string[];
  affectedUsers?: string[];
  newLikes?: number;
  oldAvatar?: string;
  newAvatar?: string;
  timestamp: string;
  conversationId?: string;
  senderId?: string;
  recipients?: string[];
  messageId?: string;
  status?: "delivered" | "read";
}

@injectable()
export class RealTimeFeedService {
  private handlerRegistry = new Map<string, IRealtimeMessageHandler>();

  constructor(
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Models.WebSocketServer)
    private readonly webSocketServer: WebSocketServer,
    @inject(TOKENS.Services.Realtime)
    private readonly handlers: IRealtimeMessageHandler[],
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {
    this.registerHandlers();
    this.initializePubSubListener();
  }

  /**
   * register all message handlers
   */
  private registerHandlers(): void {
    for (const handler of this.handlers) {
      this.handlerRegistry.set(handler.messageType, handler);
      // also register legacy alias mappings
      if (handler.messageType === EventRegistry.realtimeMessageTypes.newPost) {
        this.handlerRegistry.set(EventRegistry.realtimeMessageTypes.newImage, handler);
      }
      if (handler.messageType === EventRegistry.realtimeMessageTypes.newPostGlobal) {
        this.handlerRegistry.set(EventRegistry.realtimeMessageTypes.newImageGlobal, handler);
      }
    }
    logger.info(
      `[Realtime Feed] Registered ${this.handlerRegistry.size} realtime message handlers`,
    );
  }

  /**
   * Initialize Redis pub/sub listener for feed updates
   */
  private async initializePubSubListener(): Promise<void> {
    try {
      // Subscribe to feed_updates and messaging_updates channels for real time feed updates and message delivery
      const subscribed = await this.redisService.subscribe(
        [
          EventRegistry.redisChannels.feedUpdates,
          EventRegistry.redisChannels.messagingUpdates,
        ],
        (channel: string, message: unknown) => {
          // Handle case where message might be a string that needs parsing
          let parsedMessage: FeedUpdateMessage;
          if (typeof message === "string") {
            try {
              parsedMessage = JSON.parse(message);
            } catch (error) {
              logger.error("Failed to parse feed update message:", { error });
              return;
            }
          } else {
            parsedMessage = message as FeedUpdateMessage;
          }
          this.handleFeedUpdate(parsedMessage, channel);
        },
        { timeoutMs: 1500 },
      );

      if (!subscribed) {
        logger.warn(
          "Real-time feed listener not started because Redis is unavailable",
        );
        return;
      }

      logger.info("Real-time feed update listener initialized");
    } catch (error) {
      logger.error("Failed to initialize real-time feed listener:", { error });
    }
  }

  /**
   * Handle incoming feed update messages
   */
  private async handleFeedUpdate(
    message: FeedUpdateMessage,
    channel?: string,
  ): Promise<void> {
    try {
      logger.info("Real-time service received message:", {
        message: JSON.stringify(message),
      });
      const io = this.webSocketServer.getIO();

      const handler = this.handlerRegistry.get(message.type);
      if (handler) {
        await handler.handle(io, message, channel);
      } else {
        logger.warn("Unknown feed update type:", { type: message.type });
      }
    } catch (error) {
      logger.error("Error handling feed update:", { error });
    }
  }

  /**
   * Send a custom real-time notification to specific users
   */
  async notifyUsers(
    userIds: string[],
    event: string,
    data: unknown,
  ): Promise<void> {
    const io = this.webSocketServer.getIO();

    for (const userId of userIds) {
      io.to(userId).emit(event, data);
      this.metricsService.recordSocketEventEmitted(
        event as SocketServerEventName,
        "room",
      );
    }
  }

  /**
   * Broadcast a message to all connected users
   */
  async broadcast(event: string, data: unknown): Promise<void> {
    const io = this.webSocketServer.getIO();
    io.emit(event, data);
    this.metricsService.recordSocketEventEmitted(
      event as SocketServerEventName,
      "broadcast",
    );
  }
}
