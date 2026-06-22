import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LoginCommand } from "./login.command";
import {
  AuthenticatedSessionResult,
  AuthService,
} from "@/services/auth.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class LoginCommandHandler
  implements ICommandHandler<LoginCommand, AuthenticatedSessionResult>
{
  constructor(
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
  ) {}

  async execute(command: LoginCommand): Promise<AuthenticatedSessionResult> {
    return this.authService.login(
      command.email,
      command.password,
      command.context,
    );
  }
}
