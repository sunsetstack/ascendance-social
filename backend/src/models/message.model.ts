import mongoose, { Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { IMessage } from "@/types";

const messageSchema = new Schema<IMessage>(
  {
    publicId: {
      type: String,
      default: uuidv4,
      unique: true,
      immutable: true,
    },
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
      index: true,
    },
    senderSnapshot: {
      publicId: { type: String },
      handle: { type: String, default: "" },
      username: { type: String },
      avatar: { type: String, default: "" },
      reason: {
        type: String,
        enum: ["banned", "deleted", "unknown"],
      },
      unavailableAt: { type: Date },
    },
    body: {
      type: String,
      required: false,
      default: "",
      trim: true,
    },
    attachments: [
      {
        url: { type: String, required: true },
        type: { type: String, required: true },
        mimeType: { type: String },
        thumbnailUrl: { type: String },
      },
    ],
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true },
);

messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
messageSchema.index({ "senderSnapshot.publicId": 1 }, { sparse: true });

messageSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    if (ret._id) {
      ret.id = ret._id.toString();
      delete ret._id;
    }

    if (Array.isArray(ret.readBy)) {
      ret.readBy = ret.readBy.map((entry: mongoose.Types.ObjectId | any) =>
        typeof entry === "object" && entry !== null && "toString" in entry
          ? entry.toString()
          : entry,
      );
    }

    delete ret.__v;
    return ret;
  },
});

const Message = mongoose.model<IMessage>("Message", messageSchema);
export default Message;
