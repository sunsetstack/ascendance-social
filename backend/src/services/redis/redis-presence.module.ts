import { RedisClientType } from "redis";

export class RedisPresenceModule {
  constructor(private readonly client: RedisClientType) {}

  async markConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
    ttlSeconds: number,
  ): Promise<void> {
    const key = this.conversationPresenceKey(userId, conversationId);
    await this.client.sAdd(key, socketId);
    await this.client.expire(key, ttlSeconds);
  }

  async clearConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
  ): Promise<void> {
    const key = this.conversationPresenceKey(userId, conversationId);
    await this.client.sRem(key, socketId);
  }

  async isConversationActive(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const key = this.conversationPresenceKey(userId, conversationId);
    return (await this.client.sCard(key)) > 0;
  }

  private conversationPresenceKey(
    userId: string,
    conversationId: string,
  ): string {
    return `active_conversation:${userId}:${conversationId}`;
  }
}
