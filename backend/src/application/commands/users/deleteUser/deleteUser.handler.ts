import { Model, Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EventBus } from "@/application/common/buses/event.bus";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import {
  PostDeletedEvent,
  PostLikeCountReconciledEvent,
} from "@/application/events/post/post.event";
import { UserDeletedEvent } from "@/application/events/user/user-interaction.event";
import { verifyPassword } from "@/application/common/policies/password.policy";
import { UnitOfWork } from "@/database/UnitOfWork";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { AccountAuditSnapshotService } from "@/services/lifecycle/account-audit-snapshot.service";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import { AuthSessionService } from "@/services/auth-session.service";
import { IUser, SecurityAuditActor } from "@/types";
import {
  asMongoId,
  asPostPublicId,
  asUserPublicId,
} from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { Errors, wrapError } from "@/utils/errors";
import { DeleteUserCommand } from "./deleteUser.command";

@injectable()
export class DeleteUserCommandHandler implements ICommandHandler<
  DeleteUserCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
    @inject(TOKENS.Services.AccountLifecycle)
    private readonly accountLifecycleService: AccountLifecycleService,
    @inject(TOKENS.Services.AccountAuditSnapshot)
    private readonly accountAuditSnapshotService: AccountAuditSnapshotService,
    @inject(TOKENS.Models.User)
    private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.AuthSession)
    private readonly authSessionService: AuthSessionService,
  ) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    const reason = command.reason.trim();
    if (!reason || reason.length > 500) {
      throw Errors.validation(
        "An account deletion reason between 1 and 500 characters is required",
      );
    }
    await this.verifyPasswordWhenRequired(command);

    const targetUser = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!targetUser) {
      throw Errors.notFound("User");
    }

    const actor = await this.resolveAuditActor(command, targetUser);
    await this.accountAuditSnapshotService.capture({
      action: "delete",
      actor,
      targetUserId: new Types.ObjectId(targetUser.id),
      targetUserPublicId: targetUser.publicId,
      reason,
    });
    await this.authSessionService.revokeAllSessionsForUser(
      command.userPublicId,
    );

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const currentUser = await this.userReadRepository.findByPublicId(
          command.userPublicId,
        );
        if (!currentUser) {
          throw Errors.notFound("User");
        }

        const result = await this.accountLifecycleService.purgeUser(
          {
            _id: new Types.ObjectId(currentUser.id),
            publicId: currentUser.publicId,
            handle: currentUser.handle,
            username: currentUser.username,
            avatar: currentUser.avatar,
            cover: currentUser.cover,
          },
          { action: "delete", reason },
        );

        for (const post of result.deletedPosts) {
          const authorPublicId = asUserPublicId(
            post.authorPublicId || currentUser.publicId,
          );
          await this.eventBus.queueTransactional(
            new PostDeletedEvent(
              asPostPublicId(post.publicId),
              authorPublicId,
            ),
          );
        }

        for (const asset of result.imageAssets) {
          await this.eventBus.queueTransactional(
            new ImageAssetCleanupRequestedEvent(
              "account-deleted",
              asset.storagePublicId,
              asset.url,
              command.requestedByPublicId ?? currentUser.publicId,
              asUserPublicId(asset.ownerPublicId || currentUser.publicId),
            ),
          );
        }

        for (const post of result.reconciledPostLikes) {
          await this.eventBus.queueTransactional(
            new PostLikeCountReconciledEvent(
              asPostPublicId(post.postPublicId),
              post.likesCount,
            ),
          );
        }

        await this.eventBus.queueTransactional(
          new UserDeletedEvent(
            currentUser.publicId,
            asMongoId(currentUser.id),
            result.followerPublicIds.map((publicId) =>
              asUserPublicId(publicId),
            ),
            result.affectedRelationshipPublicIds.map((publicId) =>
              asUserPublicId(publicId),
            ),
            result.deletedPosts
              .filter(
                (post) =>
                  (post.authorPublicId || currentUser.publicId) ===
                  currentUser.publicId,
              )
              .map((post) => asPostPublicId(post.publicId)),
          ),
        );
      });
    } catch (error) {
      throw wrapError(error);
    }
  }

  private async verifyPasswordWhenRequired(
    command: DeleteUserCommand,
  ): Promise<void> {
    if (command.skipPasswordVerification) return;
    if (!command.password) {
      throw Errors.validation("Password is required for account deletion");
    }
    const userWithPassword = await this.userModel
      .findOne({ publicId: command.userPublicId })
      .select("+password")
      .exec();
    if (!userWithPassword) {
      throw Errors.notFound("User");
    }
    if (!(await verifyPassword(command.password, userWithPassword.password))) {
      throw Errors.authentication("Invalid password");
    }
  }

  private async resolveAuditActor(
    command: DeleteUserCommand,
    targetUser: IUser,
  ): Promise<SecurityAuditActor> {
    const actorPublicId = command.requestedByPublicId ?? targetUser.publicId;
    const actorUser =
      actorPublicId === targetUser.publicId
        ? targetUser
        : await this.userReadRepository.findByPublicId(actorPublicId);
    return {
      type: command.requestedByPublicId ? "admin" : "user",
      userId: actorPublicId,
      email: actorUser?.email,
      handle: actorUser?.handle,
      username: actorUser?.username,
    };
  }
}
