import { Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnitOfWork } from "@/database/UnitOfWork";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { AuthSessionService } from "@/services/auth-session.service";
import { AdminUserDTO, DTOService } from "@/services/dto.service";
import { AccountAuditSnapshotService } from "@/services/lifecycle/account-audit-snapshot.service";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import { AdminRemovalGuardService } from "@/services/admin-removal-guard.service";
import { TOKENS } from "@/types/tokens";
import { Errors, wrapError } from "@/utils/errors";
import { BanUserCommand } from "./banUser.command";

export interface BanUserResult {
  message: string;
  user: AdminUserDTO;
}

@injectable()
export class BanUserCommandHandler implements ICommandHandler<
  BanUserCommand,
  BanUserResult
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
    @inject(TOKENS.Services.AuthSession)
    private readonly authSessionService: AuthSessionService,
    @inject(TOKENS.Services.DTO)
    private readonly dtoService: DTOService,
    @inject(TOKENS.Services.AdminRemovalGuard)
    private readonly adminRemovalGuard: AdminRemovalGuardService,
  ) {}

  async execute(command: BanUserCommand): Promise<BanUserResult> {
    const reason = command.reason.trim();
    if (!reason || reason.length > 500) {
      throw Errors.validation("A ban reason between 1 and 500 characters is required");
    }
    if (command.userPublicId === command.adminPublicId) {
      throw Errors.validation("Administrators cannot ban their own account");
    }

    const targetUser = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!targetUser) throw Errors.notFound("User");

    const admin = await this.userReadRepository.findByPublicId(
      command.adminPublicId,
    );
    if (!admin) throw Errors.notFound("Admin user");

    await this.accountAuditSnapshotService.capture({
      action: "ban",
      actor: {
        type: "admin",
        userId: admin.publicId,
        email: admin.email,
        handle: admin.handle,
        username: admin.username,
      },
      targetUserId: new Types.ObjectId(targetUser.id),
      targetUserPublicId: targetUser.publicId,
      reason,
    });

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const currentUser = await this.userReadRepository.findByPublicId(
          command.userPublicId,
        );
        if (!currentUser) throw Errors.notFound("User");

        if (currentUser.isAdmin && !currentUser.isBanned) {
          await this.adminRemovalGuard.touch();
          const activeAdminCount = await this.userReadRepository.countDocuments({
            isAdmin: true,
            isBanned: false,
          });
          if (activeAdminCount <= 1) {
            throw Errors.validation(
              "At least one active administrator must remain",
            );
          }
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
            action: "ban",
            reason,
            bannedBy: new Types.ObjectId(admin.id),
            requestedByPublicId: command.adminPublicId,
          },
        );
      });
    } catch (error) {
      throw wrapError(error);
    }

    await this.authSessionService.revokeAllSessionsForUser(
      command.userPublicId,
    );

    const updatedUser = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!updatedUser) {
      throw Errors.internal("Failed to load user after ban");
    }

    return {
      message: "User banned and account content removed successfully",
      user: this.dtoService.toAdminDTO(updatedUser),
    };
  }
}
