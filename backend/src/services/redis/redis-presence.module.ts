import { RedisClientType } from "redis";
/**
 * Initial implementation of the presence system was proof of concept and not polished, which created real problems.
 * Every socket viewing a conversation was a member of the same SET.
 *
 * In Redis the KEY looks like 'active_conversation:user:conversation' with 90seconds TTL. If socket1 crashes but socket2 is alive then
 * every heartbeat keeps the Redis SET alive.
 *
 * No cleanup. When socket2 closes Redis removes it, but socket1 remains and keeps the conversation active because the key still contains the crashed socket1.
 * Every check for active conversation becomes unreliable.
 *
 * This implementation tries to fix it by using ZSET with socketID and expiration timestamp for every socket. Now the KEY active_conversation:v2:user:conversation
 * doesn't share a TTL, socket1 and socket2 have own lease. socket2's heartbeat refreshes its own TTL. Then a cleanup for expired leases is done
 *
 * 2 Lua scripts account for the problems above:
 * First one uses Redis' own TIME command(returns time in seconds and microseconds). Converts it to milliseconds adding the 90seconds TTL.
 * Calls ZREMRANGEBYSCORE(score is the expiration timestamp) and removes expired sockets and ZADD to update existing sockets.
 * Finally finds the latest expiration socket and with PEXPIREAT PEXPIREAT the sets the KEY's TTL to that socket's timestapm.
 *
 * Second one makes the expiration check accurate and effective.
 *
 * Everything else is almost the same as before, only account for the new format and adding a 'v2' to the KEY format so i don't mess up the existing Redis data.
 * The integration test checks out with real Redis and Lua engine. double checks the previous implemention's problems and confirms adding 'v2' good to go as-is
 */
const MARK_CONVERSATION_PRESENCE_SCRIPT = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expiresAt = now + math.floor(tonumber(ARGV[2]) * 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
redis.call("ZADD", KEYS[1], expiresAt, ARGV[1])
local latest = redis.call("ZREVRANGE", KEYS[1], 0, 0, "WITHSCORES")
redis.call("PEXPIREAT", KEYS[1], latest[2])
return 1
`;

const IS_CONVERSATION_ACTIVE_SCRIPT = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
return redis.call("ZCARD", KEYS[1])
`;

export class RedisPresenceModule {
  constructor(private readonly client: RedisClientType) {}

  async markConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.eval(MARK_CONVERSATION_PRESENCE_SCRIPT, {
      keys: [this.conversationPresenceKey(userId, conversationId)],
      arguments: [socketId, String(ttlSeconds)],
    });
  }

  async clearConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
  ): Promise<void> {
    const key = this.conversationPresenceKey(userId, conversationId);
    await this.client.zRem(key, socketId);
  }

  async isConversationActive(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const count = (await this.client.eval(IS_CONVERSATION_ACTIVE_SCRIPT, {
      keys: [this.conversationPresenceKey(userId, conversationId)],
      arguments: [],
    })) as number;
    return count > 0;
  }

  private conversationPresenceKey(
    userId: string,
    conversationId: string,
  ): string {
    return `active_conversation:v2:${userId}:${conversationId}`;
  }
}
