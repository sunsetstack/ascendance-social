import "reflect-metadata";
import { expect } from "chai";
import sinon, { SinonStub, SinonStubbedInstance } from "sinon";
import { NotificationService } from "@/services/notification.service";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { UserRepository } from "@/repositories/user.repository";
import { ImageRepository } from "@/repositories/image.repository";

describe("NotificationService", () => {
	let notificationService: NotificationService;
	let mockNotificationRepository: SinonStubbedInstance<NotificationRepository>;
	let mockRedisService: SinonStubbedInstance<RedisService>;
	let mockWebSocketServer: SinonStubbedInstance<WebSocketServer>;
	let mockUserRepository: SinonStubbedInstance<UserRepository>;
	let mockImageRepository: SinonStubbedInstance<ImageRepository>;
	let emitSpy: SinonStub;
	let roomSpy: SinonStub;

	beforeEach(() => {
		mockNotificationRepository = sinon.createStubInstance(NotificationRepository);
		mockRedisService = sinon.createStubInstance(RedisService);
		mockWebSocketServer = sinon.createStubInstance(WebSocketServer);
		mockUserRepository = sinon.createStubInstance(UserRepository);
		mockImageRepository = sinon.createStubInstance(ImageRepository);
		emitSpy = sinon.stub();
		roomSpy = sinon.stub().returns({ emit: emitSpy });

		// Mock WebSocketServer.getIO
		mockWebSocketServer.getIO.returns({ to: roomSpy } as any);

		// ensure backfillNotifications returns a promise (resolves to void)
		mockRedisService.backfillNotifications.resolves();
		mockRedisService.getUserNotificationIds.resolves([]);
		mockRedisService.markNotificationsRead.resolves();

		notificationService = new NotificationService(
			mockWebSocketServer as any,
			mockNotificationRepository as any,
			mockUserRepository as any,
			mockImageRepository as any,
			mockRedisService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("getNotifications", () => {
		it("should fetch from DB if Redis returns fewer items than limit (Partial Cache Hit)", async () => {
			const userId = "user123";
			const limit = 20;

			const cachedNotifications = [{ _id: "notif1", text: "New notification" }];
			mockRedisService.getUserNotifications.resolves(cachedNotifications as any);

			const dbNotifications = Array.from({ length: 25 }, (_, index) => ({ _id: `notif-${index}` }));
			mockNotificationRepository.getNotifications.resolves(dbNotifications as any);

			const result = await notificationService.getNotifications(userId, limit);

			expect(mockRedisService.getUserNotifications.calledOnceWith(userId, 1, limit)).to.be.true;
			expect(mockNotificationRepository.getNotifications.calledOnceWith(userId, 200, 0)).to.be.true;
			expect(mockRedisService.backfillNotifications.calledOnceWith(userId, dbNotifications, 200)).to.be.true;
			expect(result).to.deep.equal(
				dbNotifications.slice(0, limit).map((notification) => ({
					id: notification._id,
				})),
			);
		});

		it("should return cached notifications if count >= limit (Full Cache Hit)", async () => {
			const userId = "user123";
			const limit = 5;

			const cachedNotifications = new Array(5).fill({ _id: "notifCached" });
			mockRedisService.getUserNotifications.resolves(cachedNotifications as any);

			const result = await notificationService.getNotifications(userId, limit);

			expect(mockRedisService.getUserNotifications.calledOnceWith(userId, 1, limit)).to.be.true;
			expect(mockNotificationRepository.getNotifications.called).to.be.false; // Should NOT be called
			expect(result).to.equal(cachedNotifications);
		});

		it("should fetch from DB if Redis returns 0 items (Cache Miss)", async () => {
			const userId = "user123";
			const limit = 20;

			// empty redis array
			mockRedisService.getUserNotifications.resolves([]);

			// notifications from DB
			const dbNotifications = [{ _id: "notif1" }];
			mockNotificationRepository.getNotifications.resolves(dbNotifications as any);

			const result = await notificationService.getNotifications(userId, limit);

			expect(mockRedisService.getUserNotifications.calledOnce).to.be.true;
			expect(mockNotificationRepository.getNotifications.calledOnce).to.be.true;
			expect(result).to.deep.equal([{ id: "notif1" }]);
		});
	});

	describe("markAllAsRead", () => {
		it("updates cached notification hashes using the Redis list structure", async () => {
			mockNotificationRepository.markAllAsRead.resolves(2);
			mockRedisService.getUserNotificationIds.resolves(["notif-1", "notif-2"]);

			const result = await notificationService.markAllAsRead("user123");

			expect(result).to.equal(2);
			expect(mockRedisService.get.called).to.be.false;
			expect(mockRedisService.getUserNotificationIds.calledOnceWith("user123")).to.be.true;
			expect(mockRedisService.markNotificationsRead.calledOnceWith(["notif-1", "notif-2"])).to.be.true;
			expect(roomSpy.calledOnceWith("user123")).to.be.true;
			expect(emitSpy.calledOnceWith("all_notifications_read")).to.be.true;
		});
	});
});
