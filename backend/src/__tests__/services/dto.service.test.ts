import { describe, it } from "mocha";
import { expect } from "chai";
import { DTOService } from "@/services/dto.service";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { Types } from "mongoose";

const basePost = {
	body: "",
	slug: "",
	image: null,
	tags: [],
	commentsCount: 0,
	viewsCount: 0,
	createdAt: new Date(),
};

describe("DTOService.toPostDTO", () => {
	const service = new DTOService();

	it("prefers populated user snapshot when available", () => {
		const dto = service.toPostDTO({
			...basePost,
			publicId: asPostPublicId("post-1"),
			likesCount: 3,
			user: {
				publicId: asUserPublicId("user-123"),
				handle: "",
				username: "photoFan",
				avatar: "avatar.png",
			},
				author: {
				_id: new Types.ObjectId(),
				publicId: asUserPublicId("user-legacy"),
				handle: "",
				username: "legacyName",
					avatarUrl: "legacy.png",
				},
		} as any);

		expect(dto.user).to.deep.equal({
			publicId: "user-123",
			handle: "",
			username: "photoFan",
			avatar: "avatar.png",
		});
		expect(dto.likes).to.equal(3);
	});

	it("falls back to embedded author snapshot when user is missing", () => {
		const dto = service.toPostDTO({
			...basePost,
			publicId: asPostPublicId("post-2"),
			likesCount: 0,
				author: {
				_id: new Types.ObjectId(),
				publicId: asUserPublicId("author-456"),
				handle: "",
				username: "snapName",
					avatarUrl: "snap.png",
				},
		} as any);

		expect(dto.user).to.deep.equal({
			publicId: "author-456",
			handle: "",
			username: "snapName",
			avatar: "snap.png",
		});
	});

	it("preserves repost content for aggregated feed posts", () => {
		const dto = service.toPostDTO({
			...basePost,
			publicId: "repost-1",
			type: "repost",
			repostCount: 2,
			userPublicId: "user-1",
			likes: 1,
			user: {
				publicId: "user-1",
				handle: "sharer",
				username: "Sharer",
				avatar: "sharer.png",
			},
			repostOf: {
				publicId: "original-1",
				body: "Original post",
				slug: "original-post",
				likes: 4,
				repostCount: 3,
				commentsCount: 2,
				user: {
					publicId: "user-2",
					handle: "author",
					username: "Author",
					avatar: "author.png",
				},
				image: null,
			},
		} as any);

		expect(dto.type).to.equal("repost");
		expect(dto.repostCount).to.equal(2);
		expect(dto.repostOf).to.deep.include({
			publicId: "original-1",
			body: "Original post",
			likes: 4,
			repostCount: 3,
			commentsCount: 2,
		} as any);
		expect(dto.repostOf?.user).to.deep.equal({
			publicId: "user-2",
			handle: "author",
			username: "Author",
			avatar: "author.png",
		});
	});

	it("drops empty aggregated community placeholders", () => {
		const dto = service.toPostDTO({
			...basePost,
			publicId: "post-without-community",
			userPublicId: "user-1",
			likes: 0,
			user: {
				publicId: "user-1",
				handle: "author",
				username: "Author",
				avatar: "author.png",
			},
			community: {},
		} as any);

		expect(dto.community).to.equal(null);
	});
});
