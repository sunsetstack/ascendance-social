import { container } from "tsyringe";

import User from "@/models/user.model";
import Image, { Tag } from "@/models/image.model";
import Post from "@/models/post.model";
import PostLike from "@/models/postLike.model";
import PostView from "@/models/postView.model";
import { Comment } from "@/models/comment.model";
import { CommentLike } from "@/models/commentLike.model";
import Favorite from "@/models/favorite.model";
import Conversation from "@/models/conversation.model";
import Message from "@/models/message.model";
import Follow from "@/models/follow.model";
import Notification from "@/models/notification.model";
import UserAction from "@/models/userAction.model";
import { UserPreference } from "@/models/userPreference.model";
import { OutboxModel } from "@/models/outbox.model";
import { WebSocketServer } from "../server/socketServer";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export function registerCoreComponents(): void {
  container.register(TOKENS.Models.User, { useValue: User });
  container.register(TOKENS.Models.Image, { useValue: Image });
  container.register(TOKENS.Models.Post, { useValue: Post });
  container.register(TOKENS.Models.PostLike, { useValue: PostLike });
  container.register(TOKENS.Models.PostView, { useValue: PostView });
  container.register(TOKENS.Models.Tag, { useValue: Tag });
  container.register(TOKENS.Models.Comment, { useValue: Comment });
  container.register(TOKENS.Models.CommentLike, { useValue: CommentLike });
  container.register(TOKENS.Models.Follow, { useValue: Follow });
  container.register(TOKENS.Models.Notification, { useValue: Notification });
  container.register(TOKENS.Models.UserAction, { useValue: UserAction });
  container.register(TOKENS.Models.Outbox, { useValue: OutboxModel });
  container.register(TOKENS.Models.UserPreference, {
    useValue: UserPreference,
  });
  container.register(TOKENS.Models.Favorite, { useValue: Favorite });
  container.register(TOKENS.Models.Conversation, { useValue: Conversation });
  container.register(TOKENS.Models.Message, { useValue: Message });
  container.registerSingleton(TOKENS.Models.WebSocketServer, WebSocketServer);

  logger.info("[di] CoreComponents registered");
}
