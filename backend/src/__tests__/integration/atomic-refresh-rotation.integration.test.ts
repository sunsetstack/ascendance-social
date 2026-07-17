import "reflect-metadata";
import crypto from "crypto";
import { expect } from "chai";
import { after, before, beforeEach, describe, it } from "mocha";
import { createClient, RedisClientType } from "redis";
import { AuthSessionService } from "@/services/auth-session.service";
import { RedisService } from "@/services/redis.service";
import { RedisSessionModule } from "@/services/redis/redis-session.module";

type TestSession = {
  sid: string;
  publicId: string;
  isEmailVerified: boolean;
  refreshTokenHash: string;
  previousRefreshTokenHash?: string;
  previousRefreshTokenGraceUntil?: number;
  refreshVersion: number;
  createdAt: number;
  lastSeenAt: number;
  status: "active" | "revoked";
};

describe("Atomic refresh-token rotation integration", function () {
  this.timeout(30_000);

  let client: RedisClientType;
  let peerClient: RedisClientType;
  let sessions: RedisSessionModule;
  let peerSessions: RedisSessionModule;
  let authSessions: AuthSessionService;
  const testPrefix = `atomic-refresh:${process.pid}:`;
  const trackedSessions = new Map<string, string>();

  const digest = (value: string): string =>
    crypto.createHash("sha256").update(value, "utf8").digest("hex");

  const expectRejectionMessage = async (
    promise: Promise<unknown>,
    message: string,
  ): Promise<void> => {
    let rejection: unknown;
    try {
      await promise;
    } catch (error) {
      rejection = error;
    }
    expect(rejection).to.be.instanceOf(Error);
    expect((rejection as Error).message).to.equal(message);
  };

  const createStoredSession = async (
    label: string,
    publicId = `${testPrefix}user`,
    overrides: Partial<TestSession> = {},
  ): Promise<{ session: TestSession; currentHash: string }> => {
    const sid = crypto.randomUUID();
    const currentHash = digest(`${testPrefix}${label}:current`);
    const now = Date.now();
    const session: TestSession = {
      sid,
      publicId,
      isEmailVerified: true,
      refreshTokenHash: currentHash,
      refreshVersion: 0,
      createdAt: now,
      lastSeenAt: now,
      status: "active",
      ...overrides,
    };

    trackedSessions.set(sid, publicId);
    await sessions.saveSession(session, 60);
    return { session, currentHash };
  };

  const rotate = (
    session: TestSession,
    presentedRefreshTokenHash: string,
    nextRefreshTokenHash: string,
    options: {
      expectedRefreshVersion?: number;
      now?: number;
      graceUntil?: number;
      sessionModule?: RedisSessionModule;
    } = {},
  ) => {
    const now = options.now ?? Date.now();
    return (options.sessionModule ?? sessions).compareAndRotateSession<TestSession>({
      sid: session.sid,
      publicId: session.publicId,
      presentedRefreshTokenHash,
      nextRefreshTokenHash,
      expectedRefreshVersion:
        options.expectedRefreshVersion ?? session.refreshVersion,
      now,
      previousRefreshTokenGraceUntil:
        options.graceUntil ?? now + 60_000,
      ttlSeconds: 60,
    });
  };

  before(async function () {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error(
        "REDIS_URL is required. Run `npm run test-integration` from the repository root.",
      );
    }

    client = createClient({
      url: redisUrl,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    client.on("error", () => undefined);
    await client.connect();
    await client.ping();
    peerClient = createClient({
      url: redisUrl,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    peerClient.on("error", () => undefined);
    await peerClient.connect();
    await peerClient.ping();
    sessions = new RedisSessionModule(client);
    peerSessions = new RedisSessionModule(peerClient);
    authSessions = new AuthSessionService({
      getAuthSession: sessions.getSession.bind(sessions),
      saveAuthSession: sessions.saveSession.bind(sessions),
      compareAndRotateAuthSession:
        sessions.compareAndRotateSession.bind(sessions),
      revokeAuthSessionByRefreshToken:
        sessions.revokeRefreshSession.bind(sessions),
      getUserAuthSessionIds: sessions.getUserSessionIds.bind(sessions),
      markAuthSessionEmailVerified:
        sessions.markSessionEmailVerified.bind(sessions),
      removeAuthSessionMembership:
        sessions.removeSessionMembership.bind(sessions),
    } as unknown as RedisService);
  });

  beforeEach(async () => {
    for (const [sid, publicId] of trackedSessions) {
      await sessions.removeSession(sid, publicId);
    }
    trackedSessions.clear();
  });

  after(async () => {
    for (const [sid, publicId] of trackedSessions) {
      await sessions.removeSession(sid, publicId);
    }
    if (peerClient?.isOpen) {
      await peerClient.disconnect();
    }
    if (client?.isOpen) {
      await client.disconnect();
    }
  });

  it("allows one service-level winner for two simultaneous raw-token rotations", async () => {
    const sid = crypto.randomUUID();
    const publicId = `${testPrefix}service-user`;
    const currentToken = `${sid}.current-secret`;
    const session = await authSessions.createSession({
      sid,
      publicId,
      isEmailVerified: true,
      refreshToken: currentToken,
      ttlSeconds: 60,
    });
    trackedSessions.set(sid, publicId);
    const successors = [
      `${sid}.successor-a`,
      `${sid}.successor-b`,
    ];

    const results = await Promise.allSettled(
      successors.map((nextToken) =>
        authSessions.rotateRefreshToken(
          session,
          currentToken,
          nextToken,
          60,
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).to.have
      .length(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(rejected?.reason).to.have.property(
      "message",
      "Refresh token already rotated",
    );
    const stored = await sessions.getSession<TestSession>(sid);
    expect(stored?.refreshVersion).to.equal(1);
    expect(successors.map(digest)).to.include(stored?.refreshTokenHash);
  });

  it("allows exactly one of two simultaneous rotations for one session", async () => {
    const { session, currentHash } = await createStoredSession("two");
    const successors = [digest("two:next-a"), digest("two:next-b")];
    await sessions.removeSessionMembership(session.publicId, session.sid);
    expect(
      await client.sIsMember(
        `user:sessions:${session.publicId}`,
        session.sid,
      ),
    ).to.equal(false);

    const results = await Promise.all(
      successors.map((nextHash) => rotate(session, currentHash, nextHash)),
    );

    expect(results.map((result) => result.outcome).sort()).to.deep.equal([
      "rotated",
      "stale_previous",
    ]);
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(successors).to.include(stored?.refreshTokenHash);
    expect(stored?.previousRefreshTokenHash).to.equal(currentHash);
    expect(stored?.refreshVersion).to.equal(1);
    expect(
      await client.sIsMember(
        `user:sessions:${session.publicId}`,
        session.sid,
      ),
    ).to.equal(true);
    expect(await client.ttl(`user:sessions:${session.publicId}`)).to.be.greaterThan(0);
  });

  it("allows exactly one winner across independent Redis clients", async () => {
    const { session, currentHash } = await createStoredSession("multi-client");
    const successors = [
      digest("multi-client:next-a"),
      digest("multi-client:next-b"),
    ];

    const results = await Promise.all([
      rotate(session, currentHash, successors[0]),
      rotate(session, currentHash, successors[1], {
        sessionModule: peerSessions,
      }),
    ]);

    expect(results.map((result) => result.outcome).sort()).to.deep.equal([
      "rotated",
      "stale_previous",
    ]);
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(successors).to.include(stored?.refreshTokenHash);
    expect(stored?.refreshVersion).to.equal(1);
  });

  it("allows exactly one of ten simultaneous rotations for one session", async () => {
    const { session, currentHash } = await createStoredSession("ten");
    const successors = Array.from({ length: 10 }, (_, index) =>
      digest(`ten:next-${index}`),
    );

    const results = await Promise.all(
      successors.map((nextHash) => rotate(session, currentHash, nextHash)),
    );

    expect(results.filter((result) => result.outcome === "rotated")).to.have
      .length(1);
    expect(
      results.filter((result) => result.outcome === "stale_previous"),
    ).to.have.length(9);
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(successors).to.include(stored?.refreshTokenHash);
    expect(stored?.refreshVersion).to.equal(1);
  });

  it("rotates two distinct sessions for one user independently", async () => {
    const publicId = `${testPrefix}shared-user`;
    const first = await createStoredSession("device-a", publicId);
    const second = await createStoredSession("device-b", publicId);

    const [firstResult, secondResult] = await Promise.all([
      rotate(first.session, first.currentHash, digest("device-a:next")),
      rotate(second.session, second.currentHash, digest("device-b:next")),
    ]);

    expect(firstResult.outcome).to.equal("rotated");
    expect(secondResult.outcome).to.equal("rotated");
    expect(
      (await sessions.getSession<TestSession>(first.session.sid))
        ?.refreshVersion,
    ).to.equal(1);
    expect(
      (await sessions.getSession<TestSession>(second.session.sid))
        ?.refreshVersion,
    ).to.equal(1);
  });

  it("does not store the losing request's proposed successor", async () => {
    const { session, currentHash } = await createStoredSession("loser");
    const successors = [digest("loser:next-a"), digest("loser:next-b")];
    const results = await Promise.all(
      successors.map((nextHash) => rotate(session, currentHash, nextHash)),
    );
    const losingIndex = results.findIndex(
      (result) => result.outcome === "stale_previous",
    );
    const losingSuccessor = successors[losingIndex];

    const replay = await rotate(
      { ...session, refreshVersion: 1 },
      losingSuccessor,
      digest("loser:replay-next"),
      { expectedRefreshVersion: 1 },
    );

    expect(replay.outcome).to.equal("mismatch");
    expect(await sessions.getSession(session.sid)).to.equal(null);
  });

  it("classifies the previous token inside grace without changing the winner", async () => {
    const { session, currentHash } = await createStoredSession("grace-in");
    const winningHash = digest("grace-in:winner");
    const first = await rotate(session, currentHash, winningHash);
    expect(first.outcome).to.equal("rotated");

    const stale = await rotate(
      { ...session, refreshVersion: 1 },
      currentHash,
      digest("grace-in:discarded"),
      { expectedRefreshVersion: 1 },
    );

    expect(stale.outcome).to.equal("stale_previous");
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(stored?.refreshTokenHash).to.equal(winningHash);
    expect(stored?.refreshVersion).to.equal(1);
  });

  it("rejects previous-token reuse outside grace and revokes the session", async () => {
    const now = Date.now();
    const previousHash = digest("grace-out:previous");
    const { session } = await createStoredSession("grace-out", undefined, {
      previousRefreshTokenHash: previousHash,
      previousRefreshTokenGraceUntil: now - 1,
      refreshVersion: 1,
    });

    const result = await rotate(
      session,
      previousHash,
      digest("grace-out:next"),
      { expectedRefreshVersion: 1, now },
    );

    expect(result.outcome).to.equal("mismatch");
    expect(await sessions.getSession(session.sid)).to.equal(null);
  });

  it("returns missing for missing and expired sessions", async () => {
    const missingSession: TestSession = {
      sid: crypto.randomUUID(),
      publicId: `${testPrefix}missing-user`,
      isEmailVerified: true,
      refreshTokenHash: digest("missing:current"),
      refreshVersion: 0,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      status: "active",
    };
    const missing = await rotate(
      missingSession,
      missingSession.refreshTokenHash,
      digest("missing:next"),
    );
    expect(missing.outcome).to.equal("missing");

    const expired = await createStoredSession("expired");
    await client.pExpire(`session:${expired.session.sid}`, 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const expiredResult = await rotate(
      expired.session,
      expired.currentHash,
      digest("expired:next"),
    );
    expect(expiredResult.outcome).to.equal("missing");
    expect(
      await client.sIsMember(
        `user:sessions:${expired.session.publicId}`,
        expired.session.sid,
      ),
    ).to.equal(false);
  });

  it("keeps refresh-token logout atomic when it races with rotation", async () => {
    const { session, currentHash } = await createStoredSession(
      "refresh-logout-race",
    );

    const [rotation, revocation] = await Promise.all([
      rotate(
        session,
        currentHash,
        digest("refresh-logout-race:next"),
      ),
      peerSessions.revokeRefreshSession({
        sid: session.sid,
        presentedRefreshTokenHash: currentHash,
        now: Date.now(),
      }),
    ]);

    expect(["rotated", "missing"]).to.include(rotation.outcome);
    expect(revocation).to.equal("revoked");
    expect(await sessions.getSession(session.sid)).to.equal(null);
    expect(
      await client.sIsMember(
        `user:sessions:${session.publicId}`,
        session.sid,
      ),
    ).to.equal(false);
  });

  it("keeps logout immediate in both orderings around rotation", async () => {
    const before = await createStoredSession("logout-before");
    await sessions.removeSession(before.session.sid, before.session.publicId);
    const afterLogout = await rotate(
      before.session,
      before.currentHash,
      digest("logout-before:next"),
    );
    expect(afterLogout.outcome).to.equal("missing");

    const after = await createStoredSession("logout-after");
    const rotation = await rotate(
      after.session,
      after.currentHash,
      digest("logout-after:next"),
    );
    await sessions.removeSession(after.session.sid, after.session.publicId);
    expect(rotation.outcome).to.equal("rotated");
    expect(await sessions.getSession(after.session.sid)).to.equal(null);

    const concurrent = await createStoredSession("logout-concurrent");
    const [concurrentRotation] = await Promise.all([
      rotate(
        concurrent.session,
        concurrent.currentHash,
        digest("logout-concurrent:next"),
      ),
      sessions.removeSession(
        concurrent.session.sid,
        concurrent.session.publicId,
      ),
    ]);
    expect(["rotated", "missing"]).to.include(concurrentRotation.outcome);
    expect(await sessions.getSession(concurrent.session.sid)).to.equal(null);
    expect(
      await client.sIsMember(
        `user:sessions:${concurrent.session.publicId}`,
        concurrent.session.sid,
      ),
    ).to.equal(false);
  });

  it("keeps revoke-all immediate in both orderings around rotation", async () => {
    const publicId = `${testPrefix}revoke-all-user`;
    const before = await createStoredSession("revoke-all-before", publicId);
    await sessions.deleteUserSessions(publicId, [before.session.sid]);
    const afterRevokeAll = await rotate(
      before.session,
      before.currentHash,
      digest("revoke-all-before:next"),
    );
    expect(afterRevokeAll.outcome).to.equal("missing");

    const after = await createStoredSession("revoke-all-after", publicId);
    const rotation = await rotate(
      after.session,
      after.currentHash,
      digest("revoke-all-after:next"),
    );
    await sessions.deleteUserSessions(publicId, [after.session.sid]);
    expect(rotation.outcome).to.equal("rotated");
    expect(await sessions.getSession(after.session.sid)).to.equal(null);

    const concurrent = await createStoredSession(
      "revoke-all-concurrent",
      publicId,
    );
    const [concurrentRotation] = await Promise.all([
      rotate(
        concurrent.session,
        concurrent.currentHash,
        digest("revoke-all-concurrent:next"),
      ),
      sessions.deleteUserSessions(publicId, [concurrent.session.sid]),
    ]);
    expect(["rotated", "missing"]).to.include(concurrentRotation.outcome);
    expect(await sessions.getSession(concurrent.session.sid)).to.equal(null);
    expect(await client.exists(`user:sessions:${publicId}`)).to.equal(0);
  });

  it("returns mismatch and revokes when the presented hash is unknown", async () => {
    const { session } = await createStoredSession("mismatch");

    const result = await rotate(
      session,
      digest("mismatch:unknown"),
      digest("mismatch:next"),
    );

    expect(result.outcome).to.equal("mismatch");
    expect(await sessions.getSession(session.sid)).to.equal(null);
    expect(
      await client.sIsMember(
        `user:sessions:${session.publicId}`,
        session.sid,
      ),
    ).to.equal(false);
  });

  it("returns revoked for a non-active record without mutating it", async () => {
    const { session, currentHash } = await createStoredSession(
      "revoked",
      undefined,
      { status: "revoked" },
    );

    const result = await rotate(
      session,
      currentHash,
      digest("revoked:next"),
    );

    expect(result.outcome).to.equal("revoked");
    expect(
      (await sessions.getSession<TestSession>(session.sid))?.refreshTokenHash,
    ).to.equal(currentHash);
  });

  it("returns version_conflict without overwriting current refresh state", async () => {
    const { session, currentHash } = await createStoredSession("version");

    const result = await rotate(
      session,
      currentHash,
      digest("version:next"),
      { expectedRefreshVersion: 9 },
    );

    expect(result.outcome).to.equal("version_conflict");
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(stored?.refreshTokenHash).to.equal(currentHash);
    expect(stored?.refreshVersion).to.equal(0);
  });

  it("merges delayed metadata into the winning rotation without overwriting it", async () => {
    const rotatedCase = await createStoredSession("delayed-update", undefined, {
      isEmailVerified: false,
    });
    const winningHash = digest("delayed-update:winner");
    const rotation = await rotate(
      rotatedCase.session,
      rotatedCase.currentHash,
      winningHash,
    );
    expect(rotation.outcome).to.equal("rotated");

    const delayedLastSeenAt = Date.now() + 1_000;
    expect(
      await sessions.touchSession({
        sid: rotatedCase.session.sid,
        publicId: rotatedCase.session.publicId,
        lastSeenAt: delayedLastSeenAt,
      }),
    ).to.equal("updated");
    expect(
      await sessions.markSessionEmailVerified({
        sid: rotatedCase.session.sid,
        publicId: rotatedCase.session.publicId,
      }),
    ).to.equal("updated");

    const storedWinner = await sessions.getSession<TestSession>(
      rotatedCase.session.sid,
    );
    expect(storedWinner?.refreshTokenHash).to.equal(winningHash);
    expect(storedWinner?.refreshVersion).to.equal(1);
    expect(storedWinner?.isEmailVerified).to.equal(true);
    expect(storedWinner?.lastSeenAt).to.equal(delayedLastSeenAt);
  });

  it("keeps same-generation metadata monotonic", async () => {
    const { session } = await createStoredSession("metadata-monotonic", undefined, {
      isEmailVerified: false,
    });
    const olderLastSeenAt = session.lastSeenAt + 1_000;
    const newerLastSeenAt = session.lastSeenAt + 2_000;

    await sessions.markSessionEmailVerified({
      sid: session.sid,
      publicId: session.publicId,
    });
    await sessions.touchSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: newerLastSeenAt,
    });
    await sessions.touchSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: olderLastSeenAt,
    });

    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(stored?.isEmailVerified).to.equal(true);
    expect(stored?.lastSeenAt).to.equal(newerLastSeenAt);
  });

  it("does not let a delayed rotation regress newer activity metadata", async () => {
    const { session, currentHash } = await createStoredSession(
      "rotation-activity",
    );
    const newerLastSeenAt = session.lastSeenAt + 2_000;
    await sessions.touchSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: newerLastSeenAt,
    });

    const result = await rotate(
      session,
      currentHash,
      digest("rotation-activity:next"),
      { now: session.lastSeenAt + 1_000 },
    );

    expect(result.outcome).to.equal("rotated");
    expect(
      (await sessions.getSession<TestSession>(session.sid))?.lastSeenAt,
    ).to.equal(newerLastSeenAt);
  });

  it("preserves the live session TTL during metadata updates", async () => {
    const { session } = await createStoredSession("metadata-ttl", undefined, {
      isEmailVerified: false,
    });
    const sessionKey = `session:${session.sid}`;
    await client.pExpire(sessionKey, 5_000);
    const before = await client.pTTL(sessionKey);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    await sessions.touchSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: session.lastSeenAt + 1_000,
    });
    await sessions.markSessionEmailVerified({
      sid: session.sid,
      publicId: session.publicId,
    });

    const after = await client.pTTL(sessionKey);
    expect(after).to.be.greaterThan(0);
    expect(after).to.be.lessThan(before);
  });

  it("preserves verification when it races with rotation across clients", async () => {
    const { session, currentHash } = await createStoredSession(
      "verification-rotation",
      undefined,
      { isEmailVerified: false },
    );
    const winningHash = digest("verification-rotation:winner");

    const [rotation, verification] = await Promise.all([
      rotate(session, currentHash, winningHash),
      peerSessions.markSessionEmailVerified({
        sid: session.sid,
        publicId: session.publicId,
      }),
    ]);

    expect(rotation.outcome).to.equal("rotated");
    expect(verification).to.equal("updated");
    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(stored?.refreshTokenHash).to.equal(winningHash);
    expect(stored?.refreshVersion).to.equal(1);
    expect(stored?.isEmailVerified).to.equal(true);
  });

  it("does not let delayed metadata recreate logout", async () => {
    const loggedOut = await createStoredSession("delayed-after-logout");

    await sessions.removeSession(
      loggedOut.session.sid,
      loggedOut.session.publicId,
    );
    expect(
      await sessions.touchSession({
        sid: loggedOut.session.sid,
        publicId: loggedOut.session.publicId,
        lastSeenAt: Date.now() + 1_000,
      }),
    ).to.equal("missing");
    expect(
      await sessions.markSessionEmailVerified({
        sid: loggedOut.session.sid,
        publicId: loggedOut.session.publicId,
      }),
    ).to.equal("missing");
    expect(await sessions.getSession(loggedOut.session.sid)).to.equal(null);
  });

  it("preserves a delayed touch when email verification runs second", async () => {
    const { session } = await createStoredSession("touch-then-verification", undefined, {
      isEmailVerified: false,
    });
    const touchedAt = session.lastSeenAt + 1_000;

    expect(
      await sessions.touchSession({
        sid: session.sid,
        publicId: session.publicId,
        lastSeenAt: touchedAt,
      }),
    ).to.equal("updated");
    expect(
      await sessions.markSessionEmailVerified({
        sid: session.sid,
        publicId: session.publicId,
      }),
    ).to.equal("updated");

    const stored = await sessions.getSession<TestSession>(session.sid);
    expect(stored?.lastSeenAt).to.equal(touchedAt);
    expect(stored?.isEmailVerified).to.equal(true);
    expect(stored?.refreshTokenHash).to.equal(session.refreshTokenHash);
    expect(
      await client.sIsMember(`user:sessions:${session.publicId}`, session.sid),
    ).to.equal(true);
  });

  it("rejects an embedded SID that conflicts with the addressed Redis key", async () => {
    const { session } = await createStoredSession("embedded-sid");
    const conflictingSid = crypto.randomUUID();
    const raw = JSON.stringify({ ...session, sid: conflictingSid });
    await client.setEx(`session:${session.sid}`, 60, raw);

    const rotation = await rotate(
      session,
      session.refreshTokenHash,
      digest("embedded-sid:next"),
    );
    const touch = await sessions.touchSession({
      sid: session.sid,
      publicId: session.publicId,
      lastSeenAt: session.lastSeenAt + 1_000,
    });
    const verification = await sessions.markSessionEmailVerified({
      sid: session.sid,
      publicId: session.publicId,
    });

    expect(rotation.outcome).to.equal("identity_mismatch");
    expect(touch).to.equal("identity_mismatch");
    expect(verification).to.equal("identity_mismatch");
    expect(await client.get(`session:${session.sid}`)).to.equal(raw);
    expect(
      await client.sIsMember(`user:sessions:${session.publicId}`, session.sid),
    ).to.equal(true);
    await expectRejectionMessage(
      authSessions.getRefreshSession(`${session.sid}.presented-secret`),
      "Session is invalid or expired",
    );
  });

  it("rejects a stored public ID that differs from the expected identity", async () => {
    const { session } = await createStoredSession("public-id-mismatch");
    const expectedPublicId = `${testPrefix}other-user`;
    const raw = await client.get(`session:${session.sid}`);

    const rotation = await rotate(
      { ...session, publicId: expectedPublicId },
      session.refreshTokenHash,
      digest("public-id-mismatch:next"),
    );
    const touch = await sessions.touchSession({
      sid: session.sid,
      publicId: expectedPublicId,
      lastSeenAt: session.lastSeenAt + 1_000,
    });
    const verification = await sessions.markSessionEmailVerified({
      sid: session.sid,
      publicId: expectedPublicId,
    });

    expect(rotation.outcome).to.equal("identity_mismatch");
    expect(touch).to.equal("identity_mismatch");
    expect(verification).to.equal("identity_mismatch");
    expect(await client.get(`session:${session.sid}`)).to.equal(raw);
    expect(
      await client.sIsMember(`user:sessions:${session.publicId}`, session.sid),
    ).to.equal(true);
    expect(
      await client.sIsMember(`user:sessions:${expectedPublicId}`, session.sid),
    ).to.equal(false);
  });

  it("logs out with the previous token after rotation and in both controlled orderings", async () => {
    const rotationFirst = await createStoredSession("logout-rotation-first");
    const nextHash = digest("logout-rotation-first:next");
    expect(
      (await rotate(rotationFirst.session, rotationFirst.currentHash, nextHash))
        .outcome,
    ).to.equal("rotated");
    expect(
      await sessions.revokeRefreshSession({
        sid: rotationFirst.session.sid,
        presentedRefreshTokenHash: rotationFirst.currentHash,
        now: Date.now(),
      }),
    ).to.equal("revoked");
    expect(await sessions.getSession(rotationFirst.session.sid)).to.equal(null);
    expect(
      await client.sIsMember(
        `user:sessions:${rotationFirst.session.publicId}`,
        rotationFirst.session.sid,
      ),
    ).to.equal(false);

    const logoutFirst = await createStoredSession("logout-first");
    expect(
      await sessions.revokeRefreshSession({
        sid: logoutFirst.session.sid,
        presentedRefreshTokenHash: logoutFirst.currentHash,
        now: Date.now(),
      }),
    ).to.equal("revoked");
    expect(
      (
        await rotate(
          logoutFirst.session,
          logoutFirst.currentHash,
          digest("logout-first:next"),
        )
      ).outcome,
    ).to.equal("missing");
    expect(await sessions.getSession(logoutFirst.session.sid)).to.equal(null);
    expect(
      await client.sIsMember(
        `user:sessions:${logoutFirst.session.publicId}`,
        logoutFirst.session.sid,
      ),
    ).to.equal(false);
  });

  it("returns bounded outcomes for missing, malformed, and non-object records without mutation", async () => {
    const publicId = `${testPrefix}invalid-record-user`;
    const missingSid = crypto.randomUUID();
    await client.sAdd(`user:sessions:${publicId}`, missingSid);

    expect(
      await sessions.touchSession({
        sid: missingSid,
        publicId,
        lastSeenAt: Date.now(),
      }),
    ).to.equal("missing");
    expect(
      await sessions.markSessionEmailVerified({ sid: missingSid, publicId }),
    ).to.equal("missing");
    expect(await client.exists(`session:${missingSid}`)).to.equal(0);
    expect(
      await client.sIsMember(`user:sessions:${publicId}`, missingSid),
    ).to.equal(true);

    for (const [label, raw] of [
      ["malformed", "{not-json"],
      ["non-object", "42"],
      ["array", "[]"],
    ] as const) {
      const sid = crypto.randomUUID();
      trackedSessions.set(sid, publicId);
      await client.setEx(`session:${sid}`, 60, raw);
      await client.sAdd(`user:sessions:${publicId}`, sid);
      const shape = {
        sid,
        publicId,
        isEmailVerified: false,
        refreshTokenHash: digest(`${label}:current`),
        refreshVersion: 0,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        status: "active" as const,
      };

      expect(
        (
          await rotate(shape, shape.refreshTokenHash, digest(`${label}:next`))
        ).outcome,
      ).to.equal("invalid_record");
      expect(
        await sessions.touchSession({
          sid,
          publicId,
          lastSeenAt: Date.now() + 1_000,
        }),
      ).to.equal("invalid_record");
      expect(
        await sessions.markSessionEmailVerified({ sid, publicId }),
      ).to.equal("invalid_record");
      expect(await client.get(`session:${sid}`)).to.equal(raw);
      expect(await client.sIsMember(`user:sessions:${publicId}`, sid)).to.equal(
        true,
      );
      await expectRejectionMessage(
        authSessions.getRefreshSession(`${sid}.presented-secret`),
        "Session is invalid or expired",
      );
    }
  });

  it("rotates a legacy session without refreshVersion from generation zero", async () => {
    const sid = crypto.randomUUID();
    const publicId = `${testPrefix}legacy-user`;
    const currentHash = digest("legacy:current");
    const legacy = {
      sid,
      publicId,
      isEmailVerified: false,
      refreshTokenHash: currentHash,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      status: "active" as const,
    };
    trackedSessions.set(sid, publicId);
    await sessions.saveSession(legacy, 60);

    const result = await rotate(
      { ...legacy, refreshVersion: 0 },
      currentHash,
      digest("legacy:next"),
    );

    expect(result.outcome).to.equal("rotated");
    const stored = await sessions.getSession<TestSession>(sid);
    expect(stored?.refreshVersion).to.equal(1);
    expect(stored?.previousRefreshTokenHash).to.equal(currentHash);
    expect(await client.sIsMember(`user:sessions:${publicId}`, sid)).to.equal(
      true,
    );
  });
});
