import { expect } from "chai";
import { Types } from "mongoose";
import {
  BANNED_ACCOUNT_COMMENT,
  DELETED_ACCOUNT_COMMENT,
  UNAVAILABLE_MESSAGE_SENDER,
} from "@/application/common/policies/account-lifecycle.policy";
import { CommentRepository } from "@/repositories/comment.repository";
import { toPublicMessageDTO } from "@/services/dto/message.mapper";
import { asConversationPublicId, asMessagePublicId } from "@/types/branded";

describe("account lifecycle tombstones", () => {
  it("returns the exact account-deletion and ban comment notices", () => {
    const repository = new CommentRepository({} as any);
    const transform = (repository as any).transformComment.bind(repository);
    const base = {
      _id: new Types.ObjectId(),
      postId: { publicId: "post-public-id" },
      parentId: null,
      replyCount: 0,
      depth: 0,
      likesCount: 5,
      userId: null,
      content: "must not leak",
      createdAt: new Date(),
      updatedAt: new Date(),
      isEdited: false,
      isDeleted: true,
      deletedBy: "user",
    };

    expect(
      transform({ ...base, deletionReason: "account_deleted" }).content,
    ).to.equal(DELETED_ACCOUNT_COMMENT);
    expect(
      transform({
        ...base,
        deletedBy: "admin",
        deletionReason: "account_banned",
      }).content,
    ).to.equal(BANNED_ACCOUNT_COMMENT);
  });

  it("maps an anonymized sender without losing the message body", () => {
    const message = {
      publicId: asMessagePublicId("message-public-id"),
      conversation: new Types.ObjectId(),
      sender: null,
      senderSnapshot: {
        publicId: "deleted-user",
        handle: "",
        username: UNAVAILABLE_MESSAGE_SENDER,
        avatar: "",
        reason: "deleted" as const,
        unavailableAt: new Date(),
      },
      body: "message that the other participant still needs",
      attachments: [],
      status: "read" as const,
      readBy: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const dto = toPublicMessageDTO(
      message,
      asConversationPublicId("conversation-public-id"),
    );
    expect(dto.body).to.equal(message.body);
    expect(dto.sender.username).to.equal(UNAVAILABLE_MESSAGE_SENDER);
    expect(dto.sender.isUnavailable).to.equal(true);
    expect(dto.sender.unavailableReason).to.equal("deleted");
  });
});
