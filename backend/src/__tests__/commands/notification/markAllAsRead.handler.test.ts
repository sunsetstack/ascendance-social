import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { MarkAllAsReadCommandHandler } from "@/application/commands/notification/markAllAsRead/markAllAsRead.handler";
import { MarkAllAsReadCommand } from "@/application/commands/notification/markAllAsRead/markAllAsRead.command";

describe("MarkAllAsReadCommandHandler", () => {
	let handler: MarkAllAsReadCommandHandler;
	let notificationRepository: {
		markAllAsRead: sinon.SinonStub;
	};
	let redisService: {
		getUserNotificationIds: sinon.SinonStub;
		markNotificationsRead: sinon.SinonStub;
	};
	let emitSpy: sinon.SinonStub;
	let roomSpy: sinon.SinonStub;
	let webSocketServer: {
		getIO: sinon.SinonStub;
	};

	beforeEach(() => {
		notificationRepository = {
			markAllAsRead: sinon.stub(),
		};
		redisService = {
			getUserNotificationIds: sinon.stub(),
			markNotificationsRead: sinon.stub().resolves(),
		};
		emitSpy = sinon.stub();
		roomSpy = sinon.stub().returns({ emit: emitSpy });
		webSocketServer = {
			getIO: sinon.stub().returns({ to: roomSpy }),
		};

		handler = new MarkAllAsReadCommandHandler(
			webSocketServer as any,
			notificationRepository as any,
			redisService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("marks cached notifications as read and emits a websocket event", async () => {
		notificationRepository.markAllAsRead.resolves(2);
		redisService.getUserNotificationIds.resolves(["notif-1", "notif-2"]);

		const result = await handler.execute(
			new MarkAllAsReadCommand("user-123"),
		);

		expect(result).to.equal(2);
		expect(redisService.getUserNotificationIds.calledOnceWith("user-123")).to.be.true;
		expect(redisService.markNotificationsRead.calledOnceWith(["notif-1", "notif-2"])).to.be.true;
		expect(roomSpy.calledOnceWith("user-123")).to.be.true;
		expect(emitSpy.calledOnceWith("all_notifications_read")).to.be.true;
	});

	it("skips cache and websocket work when nothing was updated", async () => {
		notificationRepository.markAllAsRead.resolves(0);

		const result = await handler.execute(
			new MarkAllAsReadCommand("user-123"),
		);

		expect(result).to.equal(0);
		expect(redisService.getUserNotificationIds.called).to.be.false;
		expect(redisService.markNotificationsRead.called).to.be.false;
		expect(roomSpy.called).to.be.false;
		expect(emitSpy.called).to.be.false;
	});
});
