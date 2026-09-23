import { inject, injectable } from "tsyringe";
import { Model } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ChangePasswordCommand } from "./changePassword.command";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import {
  requireTransactionSession,
  UnitOfWork,
} from "@/database/UnitOfWork";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { IUser } from "@/types";
import { Errors } from "@/utils/errors";
import { asMongoId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { verifyPassword } from "@/application/common/policies/password.policy";
import { AuthService } from "@/services/auth.service";

@injectable()
export class ChangePasswordCommandHandler implements ICommandHandler<
  ChangePasswordCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.UserAction)
    private readonly userActionRepository: UserActionRepository,
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    // validation
    if (!command.newPassword || command.newPassword.length < 3) {
      throw Errors.validation("Password must be at least 3 characters long");
    }
    if (command.currentPassword === command.newPassword) {
      throw Errors.validation(
        "New password must be different from the current password",
      );
    }

    const changedUser = await this.unitOfWork.executeInTransaction(async () => {
      // Need the model directly because the password is excluded by default.
      const user = await this.userModel
        .findOne({ publicId: command.userPublicId })
        .select("+password")
        .session(requireTransactionSession())
        .exec();

      if (!user) {
        throw Errors.notFound("User");
      }

      const passwordMatches = await verifyPassword(
        command.currentPassword,
        user.password,
      );
      if (!passwordMatches) {
        throw Errors.authentication("Current password is incorrect");
      }

      const userId = asMongoId(user._id.toString());

      await this.userWriteRepository.update(userId, {
        $set: { password: command.newPassword },
        $inc: { authVersion: 1 },
        $unset: { resetToken: 1, resetTokenExpires: 1 },
      });
      await this.userActionRepository.logAction(
        userId,
        "password_change",
        userId,
      );
      return { publicId: user.publicId, email: user.email };
    });

    await this.authService.handlePasswordChanged(changedUser);
  }
}
