import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RefreshSessionCommand } from "./refreshSession.command";
import {
  AuthenticatedSessionResult,
  AuthService,
} from "@/services/auth.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class RefreshSessionCommandHandler
  implements ICommandHandler<RefreshSessionCommand, AuthenticatedSessionResult>
{
  constructor(
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
  ) {}

  async execute(
    command: RefreshSessionCommand,
  ): Promise<AuthenticatedSessionResult> {
    return this.authService.refreshSession(
      command.refreshToken,
      command.context,
    );
  }
}
