import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ResetPasswordCommand } from "./ResetPasswordCommand";
import { Errors } from "@/utils/errors";
import crypto from "crypto";
import type { IUserWriteRepository } from "@/repositories/interfaces";
import { AuthService } from "@/services/auth.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ResetPasswordHandler implements ICommandHandler<
  ResetPasswordCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
  ) {}

  async execute(command: ResetPasswordCommand): Promise<void> {
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(command.token)
      .digest("hex");
    const user = await this.userWriteRepository.consumePasswordResetToken(
      resetTokenHash,
      command.newPassword,
    );

    if (!user) {
      throw Errors.validation("Invalid or expired reset token");
    }

    await this.authService.handlePasswordChanged(user);
  }
}
