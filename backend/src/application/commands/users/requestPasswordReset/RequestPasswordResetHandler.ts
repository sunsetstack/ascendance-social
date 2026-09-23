import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RequestPasswordResetCommand } from "./RequestPasswordResetCommand";
import crypto from "crypto";
import type {
  IUserWriteRepository,
} from "@/repositories/interfaces";
import type { UserAuthenticationLookup } from "@/application/ports/user-authentication-lookup";
import { EmailService } from "@/services/email.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class RequestPasswordResetHandler implements ICommandHandler<
  RequestPasswordResetCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserAuthenticationLookup)
    private readonly userReadRepository: UserAuthenticationLookup,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.Email) private readonly emailService: EmailService,
  ) {}

  async execute(command: RequestPasswordResetCommand): Promise<void> {
    const user = await this.userReadRepository.findByEmail(command.email);
    if (!user) {
      return;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const resetTokenExpires = Date.now() + 3600000; // 1 hour

    await this.userWriteRepository.update(user.id, {
      resetToken: resetTokenHash,
      resetTokenExpires,
    });

    await this.emailService.sendPasswordResetEmail(user.email, resetToken);
  }
}
