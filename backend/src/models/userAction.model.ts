import mongoose, { Schema } from "mongoose";
import { IUserAction } from "@/types";

const userActionSchema = new Schema<IUserAction>({
	userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
	actionType: { type: String, required: true },
	targetId: { type: Schema.Types.ObjectId, required: true },
	timestamp: { type: Date, default: Date.now },
	feedEffectsApplied: { type: Boolean, select: false },
});

userActionSchema.index({ userId: 1, timestamp: -1 });

const UserAction = mongoose.model<IUserAction>("UserAction", userActionSchema);
export default UserAction;
