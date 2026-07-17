import { RedisClientType } from "redis";

type SessionRecord = {
  sid: string;
  publicId: string;
};

export type RefreshRotationOutcome =
  | "rotated"
  | "stale_previous"
  | "missing"
  | "revoked"
  | "mismatch"
  | "identity_mismatch"
  | "invalid_record"
  | "version_conflict";

export interface CompareAndRotateSessionInput {
  sid: string;
  publicId: string;
  presentedRefreshTokenHash: string;
  nextRefreshTokenHash: string;
  expectedRefreshVersion: number;
  now: number;
  previousRefreshTokenGraceUntil: number;
  ttlSeconds: number;
  ip?: string;
  userAgent?: string;
}

export interface CompareAndRotateSessionResult<T> {
  outcome: RefreshRotationOutcome;
  session: T | null;
}

export type SessionMetadataPatchOutcome =
  | "updated"
  | "missing"
  | "identity_mismatch"
  | "invalid_record";

export interface PatchSessionMetadataInput {
  sid: string;
  publicId: string;
}

export interface TouchSessionInput extends PatchSessionMetadataInput {
  lastSeenAt: number;
}

export type RefreshSessionRevocationOutcome =
  | "revoked"
  | "missing"
  | "inactive"
  | "mismatch"
  | "identity_mismatch"
  | "invalid_record";

export interface RevokeRefreshSessionInput {
  sid: string;
  presentedRefreshTokenHash: string;
  now: number;
}

const COMPARE_AND_ROTATE_SESSION_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  redis.call("SREM", KEYS[2], ARGV[9])
  return {"missing", ""}
end

local decoded, session = pcall(cjson.decode, raw)
if not decoded or type(session) ~= "table" then
  return {"invalid_record", ""}
end

if type(session.sid) ~= "string" or type(session.publicId) ~= "string" or
   type(session.refreshTokenHash) ~= "string" or type(session.status) ~= "string" then
  return {"invalid_record", ""}
end

if session.sid ~= ARGV[1] or session.publicId ~= ARGV[2] then
  return {"identity_mismatch", ""}
end

if session.status ~= "active" then
  return {"revoked", ""}
end

local presentedHash = ARGV[3]
local currentHash = session.refreshTokenHash
local previousHash = session.previousRefreshTokenHash
local now = tonumber(ARGV[6])
local graceUntil = tonumber(session.previousRefreshTokenGraceUntil or 0)

if previousHash == presentedHash then
  if graceUntil >= now then
    return {"stale_previous", ""}
  end

  redis.call("DEL", KEYS[1])
  redis.call("SREM", KEYS[2], ARGV[9])
  return {"mismatch", ""}
end

if currentHash ~= presentedHash then
  redis.call("DEL", KEYS[1])
  redis.call("SREM", KEYS[2], ARGV[9])
  return {"mismatch", ""}
end

local currentVersion = tonumber(session.refreshVersion or 0)
local expectedVersion = tonumber(ARGV[5])
if not currentVersion or currentVersion ~= expectedVersion then
  return {"version_conflict", ""}
end

session.previousRefreshTokenHash = currentHash
session.previousRefreshTokenGraceUntil = tonumber(ARGV[7])
session.refreshTokenHash = ARGV[4]
session.refreshVersion = currentVersion + 1
local currentLastSeenAt = tonumber(session.lastSeenAt or 0) or 0
if now > currentLastSeenAt then
  session.lastSeenAt = now
end
if ARGV[10] == "1" then
  session.ip = ARGV[11]
end
if ARGV[12] == "1" then
  session.userAgent = ARGV[13]
end

local encoded = cjson.encode(session)
local ttlSeconds = tonumber(ARGV[8])
redis.call("SET", KEYS[1], encoded, "EX", ttlSeconds)
redis.call("SADD", KEYS[2], ARGV[9])
redis.call("EXPIRE", KEYS[2], ttlSeconds, "NX")
redis.call("EXPIRE", KEYS[2], ttlSeconds, "GT")
return {"rotated", encoded}
`;

const TOUCH_SESSION_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return "missing"
end

local decoded, session = pcall(cjson.decode, raw)
if not decoded or type(session) ~= "table" or
   type(session.sid) ~= "string" or type(session.publicId) ~= "string" or
   type(session.lastSeenAt) ~= "number" then
  return "invalid_record"
end

if session.sid ~= ARGV[1] or session.publicId ~= ARGV[2] then
  return "identity_mismatch"
end

local proposedLastSeenAt = tonumber(ARGV[3])
if not proposedLastSeenAt then
  return "invalid_record"
end

if proposedLastSeenAt > session.lastSeenAt then
  session.lastSeenAt = proposedLastSeenAt
  redis.call("SET", KEYS[1], cjson.encode(session), "KEEPTTL")
end

return "updated"
`;

const MARK_SESSION_EMAIL_VERIFIED_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return "missing"
end

local decoded, session = pcall(cjson.decode, raw)
if not decoded or type(session) ~= "table" or
   type(session.sid) ~= "string" or type(session.publicId) ~= "string" or
   type(session.isEmailVerified) ~= "boolean" then
  return "invalid_record"
end

if session.sid ~= ARGV[1] or session.publicId ~= ARGV[2] then
  return "identity_mismatch"
end

if not session.isEmailVerified then
  session.isEmailVerified = true
  redis.call("SET", KEYS[1], cjson.encode(session), "KEEPTTL")
end

return "updated"
`;

const REVOKE_REFRESH_SESSION_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return "missing"
end

local decoded, session = pcall(cjson.decode, raw)
if not decoded or type(session) ~= "table" or
   type(session.sid) ~= "string" or type(session.publicId) ~= "string" or
   type(session.refreshTokenHash) ~= "string" or type(session.status) ~= "string" then
  return "invalid_record"
end

if session.sid ~= ARGV[1] then
  return "identity_mismatch"
end

if session.status ~= "active" then
  return "inactive"
end

local presentedHash = ARGV[2]
local now = tonumber(ARGV[3])
local currentMatches = session.refreshTokenHash == presentedHash
local previousMatches = session.previousRefreshTokenHash == presentedHash and
  tonumber(session.previousRefreshTokenGraceUntil or 0) >= now

local membershipKey = "user:sessions:" .. session.publicId
if currentMatches or previousMatches then
  redis.call("DEL", KEYS[1])
  redis.call("SREM", membershipKey, ARGV[1])
  return "revoked"
end

redis.call("DEL", KEYS[1])
redis.call("SREM", membershipKey, ARGV[1])
return "mismatch"
`;

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

  async compareAndRotateSession<T>(
    input: CompareAndRotateSessionInput,
  ): Promise<CompareAndRotateSessionResult<T>> {
    const result = (await this.client.eval(COMPARE_AND_ROTATE_SESSION_SCRIPT, {
      keys: [
        this.sessionKey(input.sid),
        this.userSessionsKey(input.publicId),
      ],
      arguments: [
        input.sid,
        input.publicId,
        input.presentedRefreshTokenHash,
        input.nextRefreshTokenHash,
        String(input.expectedRefreshVersion),
        String(input.now),
        String(input.previousRefreshTokenGraceUntil),
        String(input.ttlSeconds),
        input.sid,
        input.ip === undefined ? "0" : "1",
        input.ip ?? "",
        input.userAgent === undefined ? "0" : "1",
        input.userAgent ?? "",
      ],
    })) as [RefreshRotationOutcome, string];

    const [outcome, rawSession] = result;
    return {
      outcome,
      session: rawSession ? (JSON.parse(rawSession) as T) : null,
    };
  }

  async touchSession(
    input: TouchSessionInput,
  ): Promise<SessionMetadataPatchOutcome> {
    return this.client.eval(TOUCH_SESSION_SCRIPT, {
      keys: [this.sessionKey(input.sid)],
      arguments: [input.sid, input.publicId, String(input.lastSeenAt)],
    }) as Promise<SessionMetadataPatchOutcome>;
  }

  async markSessionEmailVerified(
    input: PatchSessionMetadataInput,
  ): Promise<SessionMetadataPatchOutcome> {
    return this.client.eval(MARK_SESSION_EMAIL_VERIFIED_SCRIPT, {
      keys: [this.sessionKey(input.sid)],
      arguments: [input.sid, input.publicId],
    }) as Promise<SessionMetadataPatchOutcome>;
  }

  async revokeRefreshSession(
    input: RevokeRefreshSessionInput,
  ): Promise<RefreshSessionRevocationOutcome> {
    return this.client.eval(REVOKE_REFRESH_SESSION_SCRIPT, {
      keys: [this.sessionKey(input.sid)],
      arguments: [
        input.sid,
        input.presentedRefreshTokenHash,
        String(input.now),
      ],
    }) as Promise<RefreshSessionRevocationOutcome>;
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

  private sessionKey(sid: string): string {
    return `session:${sid}`;
  }

  private userSessionsKey(publicId: string): string {
    return `user:sessions:${publicId}`;
  }
}
