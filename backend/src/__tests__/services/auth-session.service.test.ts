import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import crypto from "crypto";
import { AuthSessionService } from "@/services/auth-session.service";
import { RedisService } from "@/services/redis.service";

describe("AuthSessionService", () => {
	let authSessionService: AuthSessionService;
	let getAuthSessionStub: sinon.SinonStub;
	let saveAuthSessionStub: sinon.SinonStub;
	let removeAuthSessionStub: sinon.SinonStub;
	let removeAuthSessionMembershipStub: sinon.SinonStub;
	let getUserAuthSessionIdsStub: sinon.SinonStub;
	let deleteUserAuthSessionsStub: sinon.SinonStub;
	let getAuthSessionsWithTtlStub: sinon.SinonStub;
	let getAuthSessionTtlStub: sinon.SinonStub;
	let updateAuthSessionStub: sinon.SinonStub;
	let updateAuthSessionsStub: sinon.SinonStub;

	beforeEach(() => {
		getAuthSessionStub = sinon.stub();
		saveAuthSessionStub = sinon.stub().resolves();
		removeAuthSessionStub = sinon.stub().resolves();
		removeAuthSessionMembershipStub = sinon.stub().resolves();
		getUserAuthSessionIdsStub = sinon.stub().resolves([]);
		deleteUserAuthSessionsStub = sinon.stub().resolves();
		getAuthSessionsWithTtlStub = sinon.stub().resolves([]);
		getAuthSessionTtlStub = sinon.stub().resolves(3600);
		updateAuthSessionStub = sinon.stub().resolves();
		updateAuthSessionsStub = sinon.stub().resolves();

		const mockRedisService = {
			getAuthSession: getAuthSessionStub,
			saveAuthSession: saveAuthSessionStub,
			removeAuthSession: removeAuthSessionStub,
			removeAuthSessionMembership: removeAuthSessionMembershipStub,
			getUserAuthSessionIds: getUserAuthSessionIdsStub,
			deleteUserAuthSessions: deleteUserAuthSessionsStub,
			getAuthSessionsWithTtl: getAuthSessionsWithTtlStub,
			getAuthSessionTtl: getAuthSessionTtlStub,
			updateAuthSession: updateAuthSessionStub,
			updateAuthSessions: updateAuthSessionsStub,
		} as unknown as RedisService;

		authSessionService = new AuthSessionService(mockRedisService);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("creates a session and persists session plus user-session index", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const refreshToken = `${sid}.refresh-secret`;

		const session = await authSessionService.createSession({
			sid,
			publicId: "user-public-id",
			isEmailVerified: true,
			refreshToken,
			ttlSeconds: 3600,
			ip: "127.0.0.1",
			userAgent: "test-agent",
		});

		expect(session.sid).to.equal(sid);
		expect(session.publicId).to.equal("user-public-id");
		expect(session.isEmailVerified).to.equal(true);
		expect(session.status).to.equal("active");
		expect(session.refreshTokenHash).to.not.equal(refreshToken);
		expect(saveAuthSessionStub.calledOnce).to.be.true;
		expect(saveAuthSessionStub.firstCall.args[1]).to.equal(3600);
	});

	it("validates refresh token when stored hash matches", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const refreshToken = `${sid}.refresh-secret`;
		const refreshTokenHash = crypto.createHash("sha256").update(refreshToken, "utf8").digest("hex");

		getAuthSessionStub.resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			status: "active",
		});

		const session = await authSessionService.validateRefreshToken(refreshToken);
		expect(session.sid).to.equal(sid);
		expect(session.publicId).to.equal("user-public-id");
	});

	it("revokes session and throws when refresh token hash mismatches", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const refreshToken = `${sid}.refresh-secret`;

		getAuthSessionStub.onFirstCall().resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash: crypto.createHash("sha256").update("different-token", "utf8").digest("hex"),
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			status: "active",
		});
		getAuthSessionStub.onSecondCall().resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash: crypto.createHash("sha256").update("different-token", "utf8").digest("hex"),
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			status: "active",
		});

		await expect(authSessionService.validateRefreshToken(refreshToken)).to.be.rejectedWith("Refresh token reuse detected");
		expect(removeAuthSessionStub.calledOnceWith(sid, "user-public-id")).to.be.true;
	});

	it("rejects recently rotated refresh token without revoking the session", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const currentRefreshToken = `${sid}.current-refresh-secret`;
		const previousRefreshToken = `${sid}.previous-refresh-secret`;

		getAuthSessionStub.resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash: crypto.createHash("sha256").update(currentRefreshToken, "utf8").digest("hex"),
			previousRefreshTokenHash: crypto.createHash("sha256").update(previousRefreshToken, "utf8").digest("hex"),
			previousRefreshTokenGraceUntil: Date.now() + 60_000,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			status: "active",
		});

		await expect(authSessionService.validateRefreshToken(previousRefreshToken)).to.be.rejectedWith(
			"Refresh token already rotated",
		);
		expect(removeAuthSessionStub.called).to.be.false;
	});

	it("rejects duplicate rotation retries within grace period", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const priorRefreshToken = `${sid}.prior-refresh-secret`;
		const currentRefreshToken = `${sid}.current-refresh-secret`;
		const nextRefreshToken = `${sid}.next-refresh-secret`;

		getAuthSessionStub.resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash: crypto.createHash("sha256").update(currentRefreshToken, "utf8").digest("hex"),
			previousRefreshTokenHash: crypto.createHash("sha256").update(priorRefreshToken, "utf8").digest("hex"),
			previousRefreshTokenGraceUntil: Date.now() + 60_000,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			status: "active",
		});

		await expect(authSessionService.rotateRefreshToken(sid, priorRefreshToken, nextRefreshToken, 3600)).to.be.rejectedWith(
			"Refresh token already rotated",
		);
		expect(saveAuthSessionStub.called).to.be.false;
		expect(removeAuthSessionStub.called).to.be.false;
	});

	it("updates lastSeenAt during access-session validation when touch interval has elapsed", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		const previousSeen = Date.now() - 120_000;
		getAuthSessionStub.resolves({
			sid,
			publicId: "user-public-id",
			refreshTokenHash: crypto.createHash("sha256").update(`${sid}.refresh-secret`, "utf8").digest("hex"),
			createdAt: Date.now() - 300_000,
			lastSeenAt: previousSeen,
			status: "active",
		});

		const session = await authSessionService.assertAccessSession(sid, "user-public-id");

		expect(session.sid).to.equal(sid);
		expect(getAuthSessionTtlStub.calledOnceWith(sid)).to.be.true;
		expect(updateAuthSessionStub.calledOnce).to.be.true;
		expect(updateAuthSessionStub.firstCall.args[0]).to.equal(sid);
		expect(updateAuthSessionStub.firstCall.args[2]).to.equal(3600);
		expect(updateAuthSessionStub.firstCall.args[1].lastSeenAt).to.be.greaterThan(previousSeen);
	});

	it("removes stale user-session index entry when access-session key is missing", async () => {
		const sid = "3f7c90af-22a8-4a48-8e03-3ea6f865b59f";
		getAuthSessionStub.resolves(null);

		await expect(authSessionService.assertAccessSession(sid, "user-public-id")).to.be.rejectedWith(
			"Session is invalid or expired",
		);
		expect(removeAuthSessionMembershipStub.calledOnceWith("user-public-id", sid)).to.be.true;
	});

	it("revokes all sessions for a user", async () => {
		getUserAuthSessionIdsStub.resolves(["session-a", "session-b"]);

		await authSessionService.revokeAllSessionsForUser("user-public-id");

		expect(deleteUserAuthSessionsStub.calledOnceWith("user-public-id", ["session-a", "session-b"])).to.equal(true);
	});

	it("marks active sessions as email verified", async () => {
		const sessionA = "11111111-1111-4111-8111-111111111111";
		const sessionB = "22222222-2222-4222-8222-222222222222";
		const staleSession = "33333333-3333-4333-8333-333333333333";
		getUserAuthSessionIdsStub.resolves([sessionA, sessionB, staleSession]);
		getAuthSessionsWithTtlStub.resolves([
			{
				sid: sessionA,
				session: {
				sid: sessionA,
				publicId: "user-public-id",
				isEmailVerified: false,
				refreshTokenHash: crypto.createHash("sha256").update("refresh-a", "utf8").digest("hex"),
				createdAt: Date.now(),
				lastSeenAt: Date.now(),
				status: "active",
				},
				ttlSeconds: 3600,
			},
			{
				sid: sessionB,
				session: {
				sid: sessionB,
				publicId: "user-public-id",
				isEmailVerified: false,
				refreshTokenHash: crypto.createHash("sha256").update("refresh-b", "utf8").digest("hex"),
				createdAt: Date.now(),
				lastSeenAt: Date.now(),
				status: "active",
				},
				ttlSeconds: 1800,
			},
			{
				sid: staleSession,
				session: null,
				ttlSeconds: -2,
			},
		]);

		await authSessionService.markUserEmailVerified("user-public-id");

		expect(updateAuthSessionsStub.calledOnce).to.equal(true);
		const [publicId, updates, staleSessionIds] = updateAuthSessionsStub.firstCall.args;
		expect(publicId).to.equal("user-public-id");
		expect(staleSessionIds).to.deep.equal([staleSession]);
		expect(updates).to.have.length(2);
		expect(updates[0].sid).to.equal(sessionA);
		expect(updates[0].ttlSeconds).to.equal(3600);
		expect(updates[0].session.isEmailVerified).to.equal(true);
		expect(updates[1].sid).to.equal(sessionB);
		expect(updates[1].ttlSeconds).to.equal(1800);
		expect(updates[1].session.isEmailVerified).to.equal(true);
	});
});
