import mongoose, { Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { IPost } from "@/types";

const authorSchema = new Schema(
	{
		_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
		publicId: { type: String, required: true },
		handle: { type: String, required: true },
		username: { type: String, required: true },
		avatarUrl: { type: String, default: "" },
		displayName: { type: String, default: "" },
	},
	{ _id: false },
);

const postSchema = new Schema<IPost>(
	{
		publicId: {
			type: String,
			default: uuidv4,
			unique: true,
			immutable: true,
		},
		user: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		author: {
			type: authorSchema,
			required: true,
		},
		body: {
			type: String,
			trim: true,
			maxlength: 300,
		},
		slug: {
			type: String,
			trim: true,
		},
		image: {
			type: Schema.Types.ObjectId,
			ref: "Image",
			default: null,
		},
		tags: [
			{
				type: Schema.Types.ObjectId,
				ref: "Tag",
			},
		],
		likesCount: {
			type: Number,
			default: 0,
			required: true,
		},
		commentsCount: {
			type: Number,
			default: 0,
			required: true,
		},
		viewsCount: {
			type: Number,
			default: 0,
			required: true,
		},
		type: {
			type: String,
			enum: ["original", "repost"],
			default: "original",
			required: true,
		},
		status: {
			type: String,
			enum: ["pending", "active", "failed"],
			default: "active",
			required: true,
			index: true,
		},
		failureReason: {
			type: String,
			trim: true,
		},
		repostOf: {
			type: Schema.Types.ObjectId,
			ref: "Post",
			default: null,
		},
		repostCount: {
			type: Number,
			default: 0,
			required: true,
		},
		communityId: {
			type: Schema.Types.ObjectId,
			ref: "Community",
			required: false,
		},
	},
	{ timestamps: true },
);

postSchema.index({ user: 1, createdAt: -1 }); // profile feed queries
postSchema.index({ tags: 1, createdAt: -1 }); // tag discovery
postSchema.index({ body: "text" }); // text search on body
postSchema.index({ slug: 1 }, { unique: true, sparse: true }); // fast lookup by slug
postSchema.index({ commentsCount: -1, likesCount: -1 }); // engagement ranking
postSchema.index({ type: 1, createdAt: -1 }); // filter by post type (original vs repost)
postSchema.index({ status: 1, createdAt: -1 }); // hide pending/failed uploads from feeds
postSchema.index({ createdAt: -1 }, { background: true }); // recent posts
postSchema.index({ createdAt: -1, _id: -1 }, { background: true }); // cursor-based feed sort
postSchema.index({ createdAt: -1, tags: 1 }, { background: true }); // trending tags window with tag filter
postSchema.index(
	{ createdAt: -1, likesCount: -1 },
	{
		partialFilterExpression: { likesCount: { $gte: 1 } }, // trending mix: recent and likes
	},
);
postSchema.index({ repostOf: 1, createdAt: -1 }); // fetch reposts of a given post

postSchema.set("toJSON", {
	transform: (_doc, raw) => {
		const ret: any = raw;
		if (ret._id) {
			ret.id = ret._id.toString();
			delete ret._id;
		}

		if (ret.user && typeof ret.user === "object" && ret.user._id) {
			ret.user = {
				id: ret.user._id.toString(),
				handle: ret.user.handle,
				username: ret.user.username,
				publicId: ret.user.publicId,
			};
		}

		if (!ret.user && ret.author) {
			ret.user = {
				publicId: ret.author.publicId,
				handle: ret.author.handle,
				username: ret.author.username,
				avatarUrl: ret.author.avatarUrl,
			};
		}

		if (ret.author && ret.author._id) {
			ret.author._id = ret.author._id.toString();
		}

		if (Array.isArray(ret.tags)) {
			ret.tags = ret.tags.map((tag: any) => {
				if (tag && typeof tag === "object" && tag._id) {
					return { id: tag._id.toString(), tag: tag.tag };
				}
				return tag;
			});
		}

		if (ret.__v !== undefined) {
			delete ret.__v;
		}
		return ret;
	},
});

const Post = mongoose.model<IPost>("Post", postSchema);
export default Post;
