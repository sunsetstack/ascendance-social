import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import type { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import type {
  UserAvatarChangedEvent,
  UserUsernameChangedEvent,
} from "./user-interaction.event";
import type { PostUploadedEvent } from "@/application/events/post/post.event";
import type {
  IPostWriteRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { TOKENS } from "@/types/tokens";

type ProfileSnapshotEvent =
  | UserAvatarChangedEvent
  | UserUsernameChangedEvent
  | PostUploadedEvent;

@injectable()
export class UserProfileSnapshotSyncHandler implements IEventHandler<ProfileSnapshotEvent> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly posts: IPostWriteRepository,
  ) {}

  async handle(event: ProfileSnapshotEvent): Promise<void> {
    const publicId =
      "authorPublicId" in event ? event.authorPublicId : event.userPublicId;
    const user = await this.users.findByPublicId(publicId);
    if (!user || user.isBanned) return;

    await this.posts.updateAuthorSnapshot(
      new Types.ObjectId(user.id),
      {
        publicId: user.publicId,
        handle: user.handle,
        username: user.username,
        displayName: user.username,
        avatarUrl: user.avatar ?? "",
      },
      user.profileRevision ?? 0,
      "postId" in event ? event.postId : undefined,
    );
  }
}
