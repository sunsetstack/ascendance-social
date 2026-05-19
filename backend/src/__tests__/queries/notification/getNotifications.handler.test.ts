import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import { GetNotificationsQueryHandler } from "@/application/queries/notification/getNotifications/getNotifications.handler";
import { GetNotificationsQuery } from "@/application/queries/notification/getNotifications/getNotifications.query";

chai.use(chaiAsPromised);

describe("GetNotificationsQueryHandler", () => {
	let handler: GetNotificationsQueryHandler;
	let notificationRepository: {
		getNotifications: sinon.SinonStub;
		getNotificationsBeforeTimestamp: sinon.SinonStub;
	};
	let redisService: {
		getUserNotifications: sinon.SinonStub;
		backfillNotifications: sinon.SinonStub;
	};

	beforeEach(() => {
		notificationRepository = {
			getNotifications: sinon.stub(),
			getNotificationsBeforeTimestamp: sinon.stub(),
		};
		redisService = {
			getUserNotifications: sinon.stub(),
			backfillNotifications: sinon.stub().resolves(),
		};

		handler = new GetNotificationsQueryHandler(
			notificationRepository as any,
			redisService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("falls back to the repository on a partial cache hit and backfills Redis", async () => {
		const cachedNotifications = [{ id: "cached-1" }];
		const dbNotifications = Array.from({ length: 25 }, (_, index) => ({
			_id: `notif-${index}`,
		}));

		redisService.getUserNotifications.resolves(cachedNotifications);
		notificationRepository.getNotifications.resolves(dbNotifications);

		const result = await handler.execute(
			new GetNotificationsQuery("user-123", 20),
		);

		expect(redisService.getUserNotifications.calledOnceWith("user-123", 1, 20)).to.be.true;
		expect(notificationRepository.getNotifications.calledOnceWith("user-123", 200, 0)).to.be.true;
		expect(redisService.backfillNotifications.calledOnceWith("user-123", dbNotifications, 200)).to.be.true;
		expect(result).to.deep.equal(
			dbNotifications.slice(0, 20).map((notification) => ({
				id: notification._id,
			})),
		);
	});

	it("returns cached notifications when Redis has enough data", async () => {
		const cachedNotifications = Array.from({ length: 5 }, (_, index) => ({
			id: `cached-${index}`,
		}));
		redisService.getUserNotifications.resolves(cachedNotifications);

		const result = await handler.execute(
			new GetNotificationsQuery("user-123", 5),
		);

		expect(redisService.getUserNotifications.calledOnceWith("user-123", 1, 5)).to.be.true;
		expect(notificationRepository.getNotifications.called).to.be.false;
		expect(result).to.deep.equal(cachedNotifications);
	});
});
