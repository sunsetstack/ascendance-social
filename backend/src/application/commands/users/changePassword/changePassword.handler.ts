import { inject, injectable } from "tsyringe";
import { Model } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ChangePasswordCommand } from "./changePassword.command";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { UnitOfWork, sessionALS } from "@/database/UnitOfWork";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { IUser } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

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

    await this.unitOfWork.executeInTransaction(async () => {
      // need to use model directly to access password field and comparePassword method
      const user = await this.userModel
        .findOne({ publicId: command.userPublicId })
        .select("+password")
        .session(sessionALS.getStore() ?? null)
        .exec();

      if (!user) {
        throw Errors.notFound("User");
      }

      if (typeof user.comparePassword !== "function") {
        throw Errors.internal("Password comparison not available for user");
      }

      const passwordMatches = await user.comparePassword(
        command.currentPassword,
      );
      if (!passwordMatches) {
        throw Errors.authentication("Current password is incorrect");
      }

      await this.userWriteRepository.update(user.id, {
        $set: { password: command.newPassword },
      });
      await this.userActionRepository.logAction(
        user.id,
        "password_change",
        user.id,
      );
    });
  }
}
