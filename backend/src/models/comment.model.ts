import mongoose, { Schema } from "mongoose";
import { IComment } from "@/types";
import { sanitizedTextLength } from "@/utils/sanitizers";
const commentSchema = new Schema<IComment>(
	{
		content: {
			type: String,
			required: false,
			trim: true,
			validate: {
				validator: (content: string | null | undefined): boolean => !content || sanitizedTextLength(content) <= 500,
				message: "Comment cannot exceed 500 characters",
			},
		},
		postId: {
			type: Schema.Types.ObjectId,
			ref: "Post",
			required: true,
			index: true, // Index for fast queries by postid
		},
    image: {
      type: new Schema({
        docId: { type: Schema.Types.ObjectId, ref: "Image", required: true },
        publicId: { type: String, required: true }, url: { type: String, required: true },
        width: Number, height: Number,
      }, { _id: false }),
      default: null,
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
