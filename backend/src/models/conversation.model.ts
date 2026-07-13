import mongoose, { Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { IConversation } from "@/types";

const conversationSchema = new Schema<IConversation>(
  {
    publicId: {
      type: String,
      default: uuidv4,
      unique: true,
      immutable: true,
    },
    participantHash: {
      type: String,
      required: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    departedParticipants: {
      type: [
        {
          _id: false,
          publicId: { type: String, required: true },
          handle: { type: String, default: "" },
          username: { type: String, required: true },
          avatar: { type: String, default: "" },
          reason: {
            type: String,
            enum: ["banned", "deleted", "unknown"],
            required: true,
          },
          unavailableAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageAt: {
      type: Date,
    },
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    isGroup: {
      type: Boolean,
      default: false,
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    closedReason: {
      type: String,
      enum: ["banned", "deleted", "unknown"],
    },
    title: {
      type: String,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ participants: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.index(
  { "departedParticipants.publicId": 1 },
  { sparse: true },
);
conversationSchema.index({ participantHash: 1 }, { unique: true });

conversationSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    if (ret._id) {
      ret.id = ret._id.toString();
      delete ret._id;
    }

    if (ret.unreadCounts instanceof Map) {
      ret.unreadCounts = Object.fromEntries(
        (ret.unreadCounts as Map<string, number>).entries(),
      ) as any;
    }

    delete ret.__v;
    return ret;
  },
});

const Conversation = mongoose.model<IConversation>(
  "Conversation",
  conversationSchema,
);
export default Conversation;
