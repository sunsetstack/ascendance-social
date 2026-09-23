import { Model, Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { verifyPassword } from "@/application/common/policies/password.policy";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AdminRemovalGuardService } from "@/services/admin-removal-guard.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { AccountAuditSnapshotService } from "@/services/lifecycle/account-audit-snapshot.service";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import { AuthSessionService } from "@/services/auth-session.service";
import { IUser, SecurityAuditActor } from "@/types";
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
    @inject(TOKENS.Services.AccountLifecycle)
    private readonly accountLifecycleService: AccountLifecycleService,
    @inject(TOKENS.Services.AccountAuditSnapshot)
    private readonly accountAuditSnapshotService: AccountAuditSnapshotService,
    @inject(TOKENS.Models.User)
    private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.AuthSession)
    private readonly authSessionService: AuthSessionService,
    @inject(TOKENS.Services.AdminRemovalGuard)
    private readonly adminRemovalGuard: AdminRemovalGuardService,
  ) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    const reason = command.reason.trim();
    if (!reason || reason.length > 500) {
      throw Errors.validation(
        "An account deletion reason between 1 and 500 characters is required",
      );
    }
    if (
      command.requestedByPublicId &&
      command.requestedByPublicId === command.userPublicId
    ) {
      throw Errors.validation(
        "Administrators cannot delete their own account from the admin panel",
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
    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const currentUser = await this.userReadRepository.findByPublicId(
          command.userPublicId,
        );
        if (!currentUser) {
          throw Errors.notFound("User");
        }

        if (currentUser.isAdmin && !currentUser.isBanned) {
          await this.adminRemovalGuard.touch();
          await this.ensureActiveAdministratorWillRemain(currentUser);
        }

        await this.accountLifecycleService.purgeUser(
          {
            _id: new Types.ObjectId(currentUser.id),
            publicId: currentUser.publicId,
            handle: currentUser.handle,
            username: currentUser.username,
            avatar: currentUser.avatar,
            cover: currentUser.cover,
          },
          {
            action: "delete",
            reason,
            requestedByPublicId:
              command.requestedByPublicId ?? currentUser.publicId,
          },
        );
      });
    } catch (error) {
      throw wrapError(error);
    }

    await this.authSessionService.revokeAllSessionsForUser(
      command.userPublicId,
    );
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

  private async ensureActiveAdministratorWillRemain(user: IUser): Promise<void> {
    if (!user.isAdmin || user.isBanned) return;

    const activeAdminCount = await this.userReadRepository.countDocuments({
      isAdmin: true,
      isBanned: false,
    });
    if (activeAdminCount <= 1) {
      throw Errors.validation("At least one active administrator must remain");
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
