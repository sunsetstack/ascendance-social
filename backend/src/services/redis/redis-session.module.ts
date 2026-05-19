import { RedisClientType } from "redis";

type SessionRecord = {
  sid: string;
  publicId: string;
};

export interface SessionWithTtl<T> {
  sid: string;
  session: T | null;
  ttlSeconds: number;
}

export class RedisSessionModule {
  constructor(private readonly client: RedisClientType) {}

  async getSession<T>(sid: string): Promise<T | null> {
    const raw = await this.client.get(this.sessionKey(sid));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async saveSession<T extends SessionRecord>(
    session: T,
    ttlSeconds: number,
  ): Promise<void> {
    const userSessionsKey = this.userSessionsKey(session.publicId);
    const pipeline = this.client.multi();

    pipeline.setEx(
      this.sessionKey(session.sid),
      ttlSeconds,
      JSON.stringify(session),
    );
    pipeline.sAdd(userSessionsKey, session.sid);
    pipeline.expire(userSessionsKey, ttlSeconds, "NX");
    pipeline.expire(userSessionsKey, ttlSeconds, "GT");
    await pipeline.exec();
  }

  async updateSession<T>(
    sid: string,
    session: T,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.setEx(
      this.sessionKey(sid),
      ttlSeconds,
      JSON.stringify(session),
    );
  }

  async removeSession(sid: string, publicId: string): Promise<void> {
    const pipeline = this.client.multi();
    pipeline.del(this.sessionKey(sid));
    pipeline.sRem(this.userSessionsKey(publicId), sid);
    await pipeline.exec();
  }

  async removeSessionMembership(publicId: string, sid: string): Promise<void> {
    await this.client.sRem(this.userSessionsKey(publicId), sid);
  }

  async getUserSessionIds(publicId: string): Promise<string[]> {
    return this.client.sMembers(this.userSessionsKey(publicId));
  }

  async deleteUserSessions(
    publicId: string,
    sessionIds: string[],
  ): Promise<void> {
    const keysToDelete = sessionIds.map((sid) => this.sessionKey(sid));
    keysToDelete.push(this.userSessionsKey(publicId));
    await this.client.del(keysToDelete);
  }

  async getSessionTtl(sid: string): Promise<number> {
    return this.client.ttl(this.sessionKey(sid));
  }

  async getSessionsWithTtl<T>(
    sessionIds: string[],
  ): Promise<Array<SessionWithTtl<T>>> {
    if (sessionIds.length === 0) {
      return [];
    }

    const pipeline = this.client.multi();
    for (const sid of sessionIds) {
      const key = this.sessionKey(sid);
      pipeline.get(key);
      pipeline.ttl(key);
    }

    const results = await pipeline.exec();

    return sessionIds.map((sid, index) => {
      const rawSession = results?.[index * 2];
      const ttlResult = results?.[index * 2 + 1];

      let session: T | null = null;
      if (typeof rawSession === "string") {
        try {
          session = JSON.parse(rawSession) as T;
        } catch {
          session = null;
        }
      }

      return {
        sid,
        session,
        ttlSeconds: Number(ttlResult ?? -2),
      };
    });
  }

  async updateSessions<T>(
    publicId: string,
    updates: Array<SessionWithTtl<T>>,
    staleSessionIds: string[] = [],
  ): Promise<void> {
    if (updates.length === 0 && staleSessionIds.length === 0) {
      return;
    }

    const pipeline = this.client.multi();

    for (const update of updates) {
      if (!update.session || update.ttlSeconds <= 0) {
        continue;
      }

      pipeline.setEx(
        this.sessionKey(update.sid),
        update.ttlSeconds,
        JSON.stringify(update.session),
      );
    }

    for (const staleSessionId of staleSessionIds) {
      pipeline.sRem(this.userSessionsKey(publicId), staleSessionId);
    }

    await pipeline.exec();
  }

  private sessionKey(sid: string): string {
    return `session:${sid}`;
  }

  private userSessionsKey(publicId: string): string {
    return `user:sessions:${publicId}`;
  }
}
