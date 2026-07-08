import mongoose, { Schema } from "mongoose";
import { INotification } from "@/types";

const notificationSchema = new Schema<INotification>({
	userId: { type: String, required: true }, // receiver publicId
	actionType: { type: String, required: true }, // like | comment | follow
	actorId: { type: String, required: true }, // actor publicId
	actorUsername: { type: String }, // denormalized for quick display
	actorHandle: { type: String }, // denormalized handle for routing
	actorAvatar: { type: String }, // actor avatar URL for quick display
	targetId: { type: String }, // optional target publicId (post/image)
	targetType: { type: String }, // 'post' | 'image' | 'user'
	targetPreview: { type: String }, // preview text/snippet of the target content
	idempotencyKey: { type: String },
	isRead: { type: Boolean, default: false },
	timestamp: { type: Date, default: Date.now },
});

// index for efficient queries
notificationSchema.index({ userId: 1, timestamp: -1 });
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, sparse: true },
);

notificationSchema.set("toJSON", {
	transform: (_doc, ret: any) => {
		if (ret._id) {
			ret.id = ret._id.toString();
			delete ret._id;
		}
		delete ret.__v;
		return ret;
	},
});

const Notification = mongoose.model<INotification>("Notification", notificationSchema);
export default Notification;
