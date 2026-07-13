import mongoose, { Schema } from "mongoose";
import { IComment } from "@/types";
const commentSchema = new Schema<IComment>(
	{
		content: {
			type: String,
			required: true,
			trim: true,
			maxlength: 500,
		},
		postId: {
			type: Schema.Types.ObjectId,
			ref: "Post",
			required: true,
			index: true, // Index for fast queries by postid
		},
		parentId: {
			type: Schema.Types.ObjectId,
			ref: "Comment",
			default: null,
			index: true,
		},
		replyCount: {
			type: Number,
			default: 0,
			required: true,
		},
		depth: {
			type: Number,
			default: 0,
			required: true,
		},
		likesCount: {
			type: Number,
			default: 0,
			required: true,
		},
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: false,
			default: null,
			index: true, // Index for fast queries by userid
		},
		isEdited: {
			type: Boolean,
			default: false,
		},
		isDeleted: {
			type: Boolean,
			default: false,
			index: true,
		},
		deletedBy: {
			type: String,
			enum: ["user", "admin", null],
			default: null,
		},
		deletionReason: {
			type: String,
			enum: ["comment_removed", "account_deleted", "account_banned", null],
			default: null,
		},
		departedUserKey: {
			type: String,
		},
	},
	{
		timestamps: true,
	},
);

// Compound index for efficient pagination by post
commentSchema.index({ postId: 1, createdAt: -1 });

// Index for user's comments
commentSchema.index({ userId: 1, createdAt: -1 });
commentSchema.index({ departedUserKey: 1 }, { sparse: true });

// Index for fetching replies efficiently
commentSchema.index({ parentId: 1, createdAt: -1 });

// Compound index for threaded comments query: getCommentsByPostId filters by postId + parentId + sorts by createdAt
commentSchema.index({ postId: 1, parentId: 1, createdAt: -1 });

export const Comment = mongoose.model<IComment>("Comment", commentSchema);
