import crypto from "crypto";
import { inject, injectable } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import { AuthSessionRecord } from "@/types";
import {
  asSessionId,
  asUserPublicId,
  asRefreshTokenHash,
} from "@/types/branded";
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
  isEmailVerified: boolean;
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
      sid: asSessionId(input.sid),
      publicId: asUserPublicId(input.publicId),
      isEmailVerified: input.isEmailVerified,
      refreshTokenHash: asRefreshTokenHash(
        this.hashRefreshToken(input.refreshToken),
      ),
      refreshVersion: 0,
      createdAt: now,
      lastSeenAt: now,
      ip: input.ip,
      userAgent: input.userAgent,
      status: "active",
    };

    await this.redisService.saveAuthSession(session, ttlSeconds);

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
    return this.redisService.getAuthSession<AuthSessionRecord>(sid);
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
      await this.redisService.removeAuthSessionMembership(publicId, sid);
      throw Errors.authentication("Session is invalid or expired");
    }
    if (
      session.sid !== sid ||
      session.status !== "active" ||
      session.publicId !== publicId
    ) {
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
    const session = await this.getRefreshSession(refreshToken);

    const presentedHash = this.hashRefreshToken(refreshToken);
    const matchState = this.classifyRefreshTokenMatch(session, presentedHash);
    if (matchState === "recently_rotated") {
      throw Errors.authentication("Refresh token already rotated");
    }
    if (matchState !== "current") {
      await this.revokeSession(session.sid);
      throw Errors.authentication("Refresh token reuse detected");
    }

    return session;
  }

  /**
   * Loads the active session addressed by a refresh token without accepting its hash
   *
   * - Refresh orchestration needs user context before minting a successor
   * - Hash acceptance is deferred to the atomic Redis compare-and-rotate operation
   */
  async getRefreshSession(refreshToken: string): Promise<AuthSessionRecord> {
    const sid = this.extractSessionIdFromRefreshToken(refreshToken);
    if (!sid) {
      throw Errors.authentication("Invalid refresh token");
    }

    let session: unknown;
    try {
      session = await this.redisService.getAuthSession<unknown>(sid);
    } catch {
      throw Errors.authentication("Session is invalid or expired");
    }

    if (!this.isExpectedActiveRefreshSession(session, sid)) {
      throw Errors.authentication("Session is invalid or expired");
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
    current: AuthSessionRecord,
    presentedRefreshToken: string,
    nextRefreshToken: string,
    ttlSeconds: number,
    context?: SessionContext,
  ): Promise<AuthSessionRecord> {
    const now = Date.now();
    const normalizedTtl = this.normalizeTtlSeconds(ttlSeconds);
    const result =
      await this.redisService.compareAndRotateAuthSession<AuthSessionRecord>({
        sid: current.sid,
        publicId: current.publicId,
        presentedRefreshTokenHash: this.hashRefreshToken(
          presentedRefreshToken,
        ),
        nextRefreshTokenHash: this.hashRefreshToken(nextRefreshToken),
        expectedRefreshVersion: current.refreshVersion ?? 0,
        now,
        previousRefreshTokenGraceUntil:
          now + this.getRefreshRotationGraceMs(),
        ttlSeconds: normalizedTtl,
        ip: context?.ip,
        userAgent: context?.userAgent,
      });

    switch (result.outcome) {
      case "rotated":
        if (!result.session) {
          throw Errors.internal("Atomic refresh rotation returned no session");
        }
        return result.session;
      case "stale_previous":
        throw Errors.authentication("Refresh token already rotated");
      case "missing":
      case "revoked":
      case "identity_mismatch":
      case "invalid_record":
        throw Errors.authentication("Session is invalid or expired");
      case "mismatch":
        throw Errors.authentication("Refresh token reuse detected");
      case "version_conflict":
        throw Errors.authentication("Refresh session state changed");
    }
  }

  /**
   * Revokes a single session by SID
   *
   * - Device-level logout should remove only one session record
   * - Clears both the session key and the user-session index entry to avoid dangling references
   */
  async revokeSession(sid: string): Promise<void> {
    let session: AuthSessionRecord | null;
    try {
      session = await this.getSession(sid);
    } catch {
      throw Errors.authentication("Session is invalid or expired");
    }
    if (!session) return;
    if (session.sid !== sid || typeof session.publicId !== "string") {
      throw Errors.authentication("Session is invalid or expired");
    }

    await this.redisService.removeAuthSession(sid, session.publicId);
  }

  async revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
    const sid = this.extractSessionIdFromRefreshToken(refreshToken);
    if (!sid) {
      throw Errors.authentication("Invalid refresh token");
    }

    const outcome = await this.redisService.revokeAuthSessionByRefreshToken({
      sid,
      presentedRefreshTokenHash: this.hashRefreshToken(refreshToken),
      now: Date.now(),
    });

    switch (outcome) {
      case "revoked":
        return;
      case "mismatch":
        throw Errors.authentication("Refresh token reuse detected");
      case "missing":
      case "inactive":
      case "identity_mismatch":
      case "invalid_record":
        throw Errors.authentication("Session is invalid or expired");
    }
  }

  /**
   * Revokes all sessions for a user.
   *
   * - Security events often require global sign-out across all devices
   * - Efficiently invalidates every known SID for a user in Redis
   * - Deletes all session keys plus the user index key
   */
  async revokeAllSessionsForUser(publicId: string): Promise<void> {
    const sessionIds = await this.redisService.getUserAuthSessionIds(publicId);
    await this.redisService.deleteUserAuthSessions(publicId, sessionIds);
  }

  async markUserEmailVerified(publicId: string): Promise<void> {
    const sessionIds = await this.redisService.getUserAuthSessionIds(publicId);
    if (sessionIds.length === 0) return;

    const outcomes = await Promise.all(
      sessionIds.map((sid) =>
        this.redisService.markAuthSessionEmailVerified({ sid, publicId }),
      ),
    );

    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index];
      const sid = sessionIds[index];
      if (outcome === "missing") {
        await this.redisService.removeAuthSessionMembership(publicId, sid);
      } else if (outcome !== "updated") {
        throw Errors.internal("Session metadata update failed");
      }
    }
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

  private isExpectedActiveRefreshSession(
    value: unknown,
    expectedSid: string,
  ): value is AuthSessionRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const session = value as Record<string, unknown>;
    if (
      session.sid !== expectedSid ||
      typeof session.publicId !== "string" ||
      session.publicId.length === 0 ||
      typeof session.isEmailVerified !== "boolean" ||
      typeof session.refreshTokenHash !== "string" ||
      !SHA256_HEX_REGEX.test(session.refreshTokenHash) ||
      typeof session.createdAt !== "number" ||
      !Number.isFinite(session.createdAt) ||
      typeof session.lastSeenAt !== "number" ||
      !Number.isFinite(session.lastSeenAt) ||
      session.status !== "active"
    ) {
      return false;
    }

    const refreshVersion = session.refreshVersion;
    if (
      refreshVersion !== undefined &&
      (typeof refreshVersion !== "number" ||
        !Number.isInteger(refreshVersion) ||
        refreshVersion < 0)
    ) {
      return false;
    }

    const previousHash = session.previousRefreshTokenHash;
    const previousGraceUntil = session.previousRefreshTokenGraceUntil;
    if (
      previousHash !== undefined &&
      (typeof previousHash !== "string" ||
        !SHA256_HEX_REGEX.test(previousHash))
    ) {
      return false;
    }

    if (
      previousGraceUntil !== undefined &&
      (typeof previousGraceUntil !== "number" ||
        !Number.isFinite(previousGraceUntil))
    ) {
      return false;
    }

    return (previousHash === undefined) === (previousGraceUntil === undefined);
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

    const outcome = await this.redisService.touchAuthSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: now,
    });
    if (outcome === "updated") return;
    if (outcome === "missing") {
      await this.redisService.removeAuthSessionMembership(
        session.publicId,
        session.sid,
      );
    }
    throw Errors.authentication("Session is invalid or expired");
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
