import crypto from "crypto";
import { inject, injectable } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import { AuthSessionRecord } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

const SESSION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const DEFAULT_REFRESH_ROTATION_GRACE_SECONDS = 15 * 60;
const DEFAULT_ACCESS_TOUCH_INTERVAL_SECONDS = 60;

export interface SessionContext {
  ip?: string;
  userAgent?: string;
}

export interface CreateSessionInput extends SessionContext {
  sid: string;
  publicId: string;
  refreshToken: string;
  ttlSeconds: number;
}

@injectable()
export class AuthSessionService {
  /**
   * Creates a session service bound to Redis
   *
   * - Session lifecycle state must live in shared storage across app instances
   * - All auth session operations read/write through one Redis-backed service
   */
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  /**
   * Extracts and validates the session ID portion from a refresh token
   *
   * - Downstream validation needs a trusted SID before querying Redis
   * - Malformed tokens are rejected early to avoid unsafe parsing and unnecessary IO
   */
  extractSessionIdFromRefreshToken(refreshToken: string): string | null {
    const [sid, secret, ...rest] = refreshToken.split(".");
    if (!sid || !secret || rest.length > 0) return null;
    if (!SESSION_ID_REGEX.test(sid)) return null;
    return sid;
  }

  /**
   * Creates a new active session and stores it in Redis
   *
   * - Refresh tokens need revocable server-side state, not only stateless JWT data
   * - Enables server-enforced logout/revocation and per-user session indexing
   * - Persists session data with TTL and links SID into the user's session set
   */
  async createSession(input: CreateSessionInput): Promise<AuthSessionRecord> {
    const ttlSeconds = this.normalizeTtlSeconds(input.ttlSeconds);
    const now = Date.now();
    const session: AuthSessionRecord = {
      sid: input.sid,
      publicId: input.publicId,
      refreshTokenHash: this.hashRefreshToken(input.refreshToken),
      createdAt: now,
      lastSeenAt: now,
      ip: input.ip,
      userAgent: input.userAgent,
      status: "active",
    };

    const pipeline = this.redisService.clientInstance.multi();
    pipeline.setEx(
      this.sessionKey(input.sid),
      ttlSeconds,
      JSON.stringify(session),
    );
    pipeline.sAdd(this.userSessionsKey(input.publicId), input.sid);
    pipeline.expire(this.userSessionsKey(input.publicId), ttlSeconds);
    await pipeline.exec();

    return session;
  }

  /**
   * Returns a session record by SID
   *
   * - Auth checks need current server-side session state
   * - SID format validation prevents accidental or malicious invalid key lookups
   */
  async getSession(sid: string): Promise<AuthSessionRecord | null> {
    if (!SESSION_ID_REGEX.test(sid)) return null;
    return this.redisService.get<AuthSessionRecord>(this.sessionKey(sid));
  }

  /**
   * Verifies that the access request references an active session owned by the given user
   *
   * - Valid access tokens should still fail when backing session state is revoked/expired/mismatched
   * - Blocks stale or stolen token usage tied to invalid session state
   * - Enforces ownership, status and updates activity timestamp opportunistically
   */
  async assertAccessSession(
    sid: string,
    publicId: string,
  ): Promise<AuthSessionRecord> {
    const session = await this.getSession(sid);
    if (!session) {
      // If the session key was evicted proactively clear stale membership index entry
      await this.redisService.clientInstance.sRem(
        this.userSessionsKey(publicId),
        sid,
      );
      throw Errors.authentication("Session is invalid or expired");
    }
    if (session.status !== "active" || session.publicId !== publicId) {
      throw Errors.authentication("Session is invalid or expired");
    }
    await this.touchSessionOnAccess(session);
    return session;
  }

  /**
   * Validates a presented refresh token against stored session hashes
   *
   * - Refresh endpoints are prime replay targets and require strict server-side checks
   * - Distinguishes valid current token from recently rotated token and token reuse
   * - Returns session only for valid token and revokes session on suspicious reuse
   */
  async validateRefreshToken(refreshToken: string): Promise<AuthSessionRecord> {
    const sid = this.extractSessionIdFromRefreshToken(refreshToken);
    if (!sid) {
      throw Errors.authentication("Invalid refresh token");
    }

    const session = await this.getSession(sid);
    if (!session || session.status !== "active") {
      throw Errors.authentication("Session is invalid or expired");
    }

    const presentedHash = this.hashRefreshToken(refreshToken);
    const matchState = this.classifyRefreshTokenMatch(session, presentedHash);
    if (matchState === "recently_rotated") {
      throw Errors.authentication("Refresh token already rotated");
    }
    if (matchState !== "current") {
      await this.revokeSession(sid);
      throw Errors.authentication("Refresh token reuse detected");
    }

    return session;
  }

  /**
   * Rotates a session refresh token to a new value while preserving a short grace window
   *
   * - Rotation improves security, but concurrent in-flight requests can present the previous token briefly
   * - Grace window prevents race-condition lockouts while still detecting malicious reuse
   * - Stores next token hash, tracks previous hash grace period, and refreshes session metadata
   */
  async rotateRefreshToken(
    sid: string,
    presentedRefreshToken: string,
    nextRefreshToken: string,
    ttlSeconds: number,
    context?: SessionContext,
  ): Promise<AuthSessionRecord> {
    const current = await this.getSession(sid);
    if (!current || current.status !== "active") {
      throw Errors.authentication("Session is invalid or expired");
    }

    const presentedHash = this.hashRefreshToken(presentedRefreshToken);
    const matchState = this.classifyRefreshTokenMatch(current, presentedHash);
    if (matchState === "recently_rotated") {
      throw Errors.authentication("Refresh token already rotated");
    }
    if (matchState !== "current") {
      await this.revokeSession(sid);
      throw Errors.authentication("Refresh token reuse detected");
    }

    const now = Date.now();
    const normalizedTtl = this.normalizeTtlSeconds(ttlSeconds);
    const next: AuthSessionRecord = {
      ...current,
      refreshTokenHash: this.hashRefreshToken(nextRefreshToken),
      previousRefreshTokenHash: current.refreshTokenHash,
      previousRefreshTokenGraceUntil: now + this.getRefreshRotationGraceMs(),
      lastSeenAt: now,
      ip: context?.ip ?? current.ip,
      userAgent: context?.userAgent ?? current.userAgent,
    };

    const pipeline = this.redisService.clientInstance.multi();
    pipeline.setEx(this.sessionKey(sid), normalizedTtl, JSON.stringify(next));
    pipeline.sAdd(this.userSessionsKey(next.publicId), sid);
    pipeline.expire(this.userSessionsKey(next.publicId), normalizedTtl);
    await pipeline.exec();

    return next;
  }

  /**
   * Revokes a single session by SID
   *
   * - Device-level logout should remove only one session record
   * - Clears both the session key and the user-session index entry to avoid dangling references
   */
  async revokeSession(sid: string): Promise<void> {
    const session = await this.getSession(sid);
    if (!session) return;

    const pipeline = this.redisService.clientInstance.multi();
    pipeline.del(this.sessionKey(sid));
    pipeline.sRem(this.userSessionsKey(session.publicId), sid);
    await pipeline.exec();
  }

  /**
   * Revokes all sessions for a user.
   *
   * - Security events often require global sign-out across all devices
   * - Efficiently invalidates every known SID for a user in Redis
   * - Deletes all session keys plus the user index key
   */
  async revokeAllSessionsForUser(publicId: string): Promise<void> {
    const userSessionsKey = this.userSessionsKey(publicId);
    const sessionIds =
      await this.redisService.clientInstance.sMembers(userSessionsKey);
    if (sessionIds.length === 0) {
      await this.redisService.clientInstance.del(userSessionsKey);
      return;
    }

    const keysToDelete = sessionIds.map((sid) => this.sessionKey(sid));
    keysToDelete.push(userSessionsKey);
    await this.redisService.clientInstance.del(keysToDelete);
  }

  /**
   * Builds the Redis key name for a single session record
   * - One key format definition avoids inconsistencies and key-typo bugs
   */
  private sessionKey(sid: string): string {
    return `session:${sid}`;
  }

  /**
   * Builds the Redis key for the set of a user's active session IDs
   * - this index supports bulk revoke and stale SID cleanup
   */
  private userSessionsKey(publicId: string): string {
    return `user:sessions:${publicId}`;
  }

  /**
   * Hashes a refresh token using SHA-256
   * - plaintext refresh tokens should never be stored server-side
   * - limits blast radius if session storage is leaked
   */
  private hashRefreshToken(refreshToken: string): string {
    return crypto
      .createHash("sha256")
      .update(refreshToken, "utf8")
      .digest("hex");
  }

  /**
   * Compares two hashes in constant time after validating hex format
   *
   * - naive comparisons can leak timing information and malformed input should fail safely
   * - reduces side-channel exposure during token verification
   * - aka avoids timing attacks
   */
  private hashesMatch(storedHash: string, presentedHash: string): boolean {
    if (
      !SHA256_HEX_REGEX.test(storedHash) ||
      !SHA256_HEX_REGEX.test(presentedHash)
    ) {
      return false;
    }

    const stored = Buffer.from(storedHash, "hex");
    const presented = Buffer.from(presentedHash, "hex");
    if (stored.length !== presented.length) return false;

    return crypto.timingSafeEqual(stored, presented);
  }

  /**
   * Classifies how a presented refresh-token hash relates to stored session hashes
   *
   * - Refresh flows need explicit state to handle current token, grace-period token and unknown token
   * - Enables clear policy handling for normal rotation vs suspected replay
   */
  private classifyRefreshTokenMatch(
    session: AuthSessionRecord,
    presentedHash: string,
    now: number = Date.now(),
  ): "current" | "recently_rotated" | "unknown" {
    if (this.hashesMatch(session.refreshTokenHash, presentedHash)) {
      return "current";
    }

    const previousHash = session.previousRefreshTokenHash;
    const previousGraceUntil = session.previousRefreshTokenGraceUntil ?? 0;
    if (
      previousHash &&
      this.hashesMatch(previousHash, presentedHash) &&
      previousGraceUntil >= now
    ) {
      return "recently_rotated";
    }

    return "unknown";
  }

  /**
   * Updates `lastSeenAt` for active usage throttled by a configurable interval
   *
   * - Writing on every request is expensive, but periodic touch preserves activity signal
   * - Balances Redis write load and accurate session activity tracking without changing TTL policy
   * - Keeps existing TTL, updates activity when required and cleans stale index entries on expiry
   */
  private async touchSessionOnAccess(
    session: AuthSessionRecord,
  ): Promise<void> {
    const now = Date.now();

    // Small performance optimization to avoid calling Redis on every request
    if (now - session.lastSeenAt < this.getAccessTouchIntervalMs()) {
      return;
    }

    const key = this.sessionKey(session.sid);
    const ttlSeconds = await this.redisService.clientInstance.ttl(key);
    if (ttlSeconds <= 0) {
      await this.redisService.clientInstance.sRem(
        this.userSessionsKey(session.publicId),
        session.sid,
      );
      throw Errors.authentication("Session is invalid or expired");
    }

    const touchedSession: AuthSessionRecord = {
      ...session,
      lastSeenAt: now,
    };
    await this.redisService.clientInstance.setEx(
      key,
      ttlSeconds,
      JSON.stringify(touchedSession),
    );
  }

  /**
   * Returns configured refresh-rotation grace window in milliseconds
   *
   * - Operators can tune replay tolerance without code changes
   */
  private getRefreshRotationGraceMs(): number {
    return (
      this.readPositiveIntegerEnv(
        "REFRESH_TOKEN_ROTATION_GRACE_SECONDS",
        DEFAULT_REFRESH_ROTATION_GRACE_SECONDS,
      ) * 1000
    );
  }

  /**
   * Returns configured minimum interval between access-touch writes in milliseconds
   *
   * - Avoids high-frequency writes while still keeping session activity reasonably up to date
   */
  private getAccessTouchIntervalMs(): number {
    return (
      this.readPositiveIntegerEnv(
        "SESSION_ACCESS_TOUCH_INTERVAL_SECONDS",
        DEFAULT_ACCESS_TOUCH_INTERVAL_SECONDS,
      ) * 1000
    );
  }

  /**
   * Reads a positive integer env var with fallback
   *
   * - Deployment env values may be absent or malformed
   * - Prevents invalid runtime config from breaking auth behavior
   */
  private readPositiveIntegerEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (raw === undefined) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  /**
   * Validates and normalizes TTL seconds for Redis expiration operations
   *
   * - Invalid TTL input would create incorrect or failing persistence behavior
   * - Enforces safe positive integer TTL before any write
   */
  private normalizeTtlSeconds(ttlSeconds: number): number {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw Errors.internal("Invalid session TTL configuration");
    }
    return Math.floor(ttlSeconds);
  }
}
