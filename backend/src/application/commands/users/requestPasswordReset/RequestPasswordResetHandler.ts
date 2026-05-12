import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RequestPasswordResetCommand } from "./RequestPasswordResetCommand";
import crypto from "crypto";
import type {
  IUserReadRepository,
  IUserWriteRepository,
} from "@/repositories/interfaces";
import { EmailService } from "@/services/email.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class RequestPasswordResetHandler implements ICommandHandler<
  RequestPasswordResetCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.Email) private readonly emailService: EmailService,
  ) {}

  async execute(command: RequestPasswordResetCommand): Promise<void> {
    const user = await this.userReadRepository.findByEmail(command.email);
    if (!user) {
      return;
    }

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpires = Date.now() + 3600000; // 1 hour

    await this.userWriteRepository.update(user.id, {
      resetToken,
      resetTokenExpires,
    });

    await this.emailService.sendPasswordResetEmail(user.email, resetToken);
  }
}
