import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ResetPasswordCommand } from "./ResetPasswordCommand";
import { Errors } from "@/utils/errors";
import type {
  IUserReadRepository,
  IUserWriteRepository,
} from "@/repositories/interfaces";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ResetPasswordHandler implements ICommandHandler<
  ResetPasswordCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
  ) {}

  async execute(command: ResetPasswordCommand): Promise<void> {
    const user = await this.userReadRepository.findByResetToken(command.token);

    if (!user) {
      throw Errors.validation("Invalid or expired reset token");
    }

    await this.userWriteRepository.update(user.id, {
      $set: { password: command.newPassword },
      $unset: { resetToken: 1, resetTokenExpires: 1 },
    });
  }
}
