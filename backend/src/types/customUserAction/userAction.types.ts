import mongoose, { Document } from "mongoose";

export interface IUserAction extends Document {
	userId: mongoose.Types.ObjectId;
	actionType: string; // like, follow, upload etc
	targetId: mongoose.Types.ObjectId; // postId or UserId etc
	timestamp: Date;
	feedEffectsApplied?: boolean;
}
