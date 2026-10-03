import { expect } from "chai";
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { RedisPresenceModule } from "@/services/redis/redis-presence.module";

describe("Conversation presence leases with real Redis", function () {
  this.timeout(10_000);
  let client: RedisClientType;
  let presence: RedisPresenceModule;
  let userId: string;
  let conversationId: string;

  async function redisTimeMs(): Promise<number> {
    const [seconds, microseconds] = await client.sendCommand(["TIME"]) as string[];
    return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
  }

  async function awaitRedisTime(deadlineMs: number): Promise<void> {
    const timeoutAt = Date.now() + 5000;
    while (await redisTimeMs() < deadlineMs) {
      if (Date.now() >= timeoutAt) throw new Error("Redis lease expiry deadline was not reached");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  beforeEach(async () => {
    const url = process.env.SOCKET_PRESENCE_TEST_REDIS_URL ?? process.env.REDIS_URL;
    if (!url) throw new Error("Set SOCKET_PRESENCE_TEST_REDIS_URL to an isolated Redis test instance");
    client = createClient({ url });
    await client.connect();
    presence = new RedisPresenceModule(client);
    userId = randomUUID();
    conversationId = randomUUID();
  });

  afterEach(async () => {
    if (client?.isOpen) {
      await presence.clearConversationPresence(userId, conversationId, "socket-A");
      await presence.clearConversationPresence(userId, conversationId, "socket-B");
      await client.quit();
    }
  });

  it("does not retain an abandoned socket when a healthy tab renews and then closes", async () => {
    await presence.markConversationPresence(userId, conversationId, "socket-A", 1);
    const abandonedLeaseDeadline = await redisTimeMs() + 1000;
    await presence.markConversationPresence(userId, conversationId, "socket-B", 30);
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await awaitRedisTime(abandonedLeaseDeadline);
    await presence.markConversationPresence(userId, conversationId, "socket-B", 30);
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await presence.clearConversationPresence(userId, conversationId, "socket-B");
    expect(await presence.isConversationActive(userId, conversationId),
      "an expired abandoned socket must not suppress notifications after the healthy tab closes").to.equal(false);
  });

  it("retains another live tab when one closes and refresh does not duplicate a socket", async () => {
    await presence.markConversationPresence(userId, conversationId, "socket-A", 30);
    await presence.markConversationPresence(userId, conversationId, "socket-B", 30);
    await presence.clearConversationPresence(userId, conversationId, "socket-A");
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await presence.markConversationPresence(userId, conversationId, "socket-B", 30);
    await presence.markConversationPresence(userId, conversationId, "socket-B", 30);
    await presence.clearConversationPresence(userId, conversationId, "socket-B");
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
  });

  it("renews a socket's own lease beyond its original expiry", async () => {
    await presence.markConversationPresence(userId, conversationId, "socket-A", 1);
    const originalDeadline = await redisTimeMs() + 1000;
    await presence.markConversationPresence(userId, conversationId, "socket-A", 30);
    await awaitRedisTime(originalDeadline);
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await presence.clearConversationPresence(userId, conversationId, "socket-A");
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
  });

  it("does not shorten a live socket's lease when a different socket has a shorter lease", async () => {
    await presence.markConversationPresence(userId, conversationId, "socket-A", 30);
    await presence.markConversationPresence(userId, conversationId, "socket-B", 1);
    const shorterDeadline = await redisTimeMs() + 1000;
    await awaitRedisTime(shorterDeadline);
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await presence.clearConversationPresence(userId, conversationId, "socket-A");
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
  });

  it("expires an idle socket independently of reads", async () => {
    await presence.markConversationPresence(userId, conversationId, "socket-A", 1);
    const deadline = await redisTimeMs() + 1000;
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
    await awaitRedisTime(deadline);
    expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
    expect(await client.exists(`active_conversation:v2:${userId}:${conversationId}`)).to.equal(0);
  });

  it("keeps new leases bounded and separate from legacy SET presence", async () => {
    const legacyKey = `active_conversation:${userId}:${conversationId}`;
    const key = `active_conversation:v2:${userId}:${conversationId}`;
    await client.sAdd(legacyKey, "abandoned-legacy-socket");
    await client.expire(legacyKey, 30);
    try {
      expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
      await presence.markConversationPresence(userId, conversationId, "socket-A", 30);
      expect(await client.type(key)).to.equal("zset");
      expect(await client.pTTL(key)).to.be.greaterThan(0).and.at.most(30_000);
      expect(await presence.isConversationActive(userId, conversationId)).to.equal(true);
      await presence.clearConversationPresence(userId, conversationId, "socket-A");
      expect(await presence.isConversationActive(userId, conversationId)).to.equal(false);
      expect(await client.exists(key)).to.equal(0);
      expect(await client.type(legacyKey)).to.equal("set");
    } finally {
      await client.del(legacyKey);
    }
  });
});
