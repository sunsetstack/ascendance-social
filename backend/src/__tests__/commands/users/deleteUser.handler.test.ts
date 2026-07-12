import { expect } from "chai";
import sinon from "sinon";
import { DeleteUserCommandHandler } from "@/application/commands/users/deleteUser/deleteUser.handler";
import { asUserPublicId } from "@/types/branded";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { Types } from "mongoose";

describe("DeleteUserCommandHandler", () => {
	let handler: DeleteUserCommandHandler;
	let mocks: any = {};

	beforeEach(() => {
		mocks.userReadRepository = {
			findUsersFollowing: sinon.stub().resolves([]),
			findByPublicId: sinon.stub(),
		};
		mocks.userWriteRepository = {
			updateFollowerCount: sinon.stub().resolves(),
			updateFollowingCount: sinon.stub().resolves(),
			delete: sinon.stub().resolves(),
		};
		mocks.imageRepository = { deleteMany: sinon.stub().resolves() };
		mocks.postWriteRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.postLikeRepository = { removeLikesByUser: sinon.stub().resolves() };
		mocks.commentRepository = { deleteCommentsByUserId: sinon.stub().resolves() };
		mocks.followRepository = {
			getFollowingObjectIds: sinon.stub().resolves([]),
			getFollowerObjectIds: sinon.stub().resolves([]),
			deleteAllFollowsByUserId: sinon.stub().resolves(),
		};
		mocks.favoriteRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.notificationRepository = {
			deleteManyByUserId: sinon.stub().resolves(),
			deleteManyByActorId: sinon.stub().resolves(),
		};
		mocks.userActionRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.userPreferenceRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.conversationRepository = {
			findByParticipant: sinon.stub().resolves([]),
			delete: sinon.stub().resolves(),
			removeParticipant: sinon.stub().resolves(),
		};
		mocks.messageRepository = {
			deleteManyBySender: sinon.stub().resolves(),
			removeUserFromReadBy: sinon.stub().resolves(),
		};
		mocks.postViewRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.communityRepository = { decrementMemberCountsByIds: sinon.stub().resolves() };
		mocks.communityMemberRepository = { deleteManyByUserId: sinon.stub().resolves() };
		mocks.imageStorageService = { deleteMany: sinon.stub().resolves({ result: "ok" }) };
		mocks.unitOfWork = {
			executeInTransaction: sinon.stub().callsFake(async (fn) => await fn("session")),
		};
		mocks.eventBus = { queueTransactional: sinon.stub().resolves() };
		mocks.userModel = { findOne: sinon.stub() };

		handler = new DeleteUserCommandHandler(
			mocks.userReadRepository,
			mocks.userWriteRepository,
			mocks.imageRepository,
			mocks.postWriteRepository,
			mocks.postLikeRepository,
			mocks.commentRepository,
			mocks.followRepository,
			mocks.favoriteRepository,
			mocks.notificationRepository,
			mocks.userActionRepository,
			mocks.userPreferenceRepository,
			mocks.conversationRepository,
			mocks.messageRepository,
			mocks.postViewRepository,
			mocks.communityRepository,
			mocks.communityMemberRepository,
			mocks.imageStorageService,
			mocks.unitOfWork,
			mocks.eventBus,
			mocks.userModel
		);
	});

	it("should remove user from joined communities and update member counts", async () => {
		const userId = new Types.ObjectId();
		const communityId1 = new Types.ObjectId();
		const communityId2 = new Types.ObjectId();
		const userPublicId = asUserPublicId("user-123");

		const mockUser = {
			id: userId.toString(),
			_id: userId,
			publicId: userPublicId,
			joinedCommunities: [
				{ _id: communityId1, name: "Community 1", slug: "c1" },
				{ _id: communityId2, name: "Community 2", slug: "c2" },
			],
		};

		mocks.userReadRepository.findByPublicId.resolves(mockUser);
		
		const command = new DeleteUserCommand(userPublicId, undefined, true);
		await handler.execute(command);

		// verify community member count updates
		expect(mocks.communityRepository.decrementMemberCountsByIds.calledOnce).to.be.true;
		expect(mocks.communityRepository.decrementMemberCountsByIds.firstCall.args[0]).to.deep.equal([
			communityId1.toString(),
			communityId2.toString(),
		]);

		// verify community membership deletion
		expect(mocks.communityMemberRepository.deleteManyByUserId.calledWith(userId.toString())).to.be.true;
	});
});
