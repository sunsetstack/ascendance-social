import { AuthSessionContext } from "@/services/auth.service";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class LoginCommand implements ICommand {
  readonly type = "LoginCommand";

  constructor(
    public readonly email: string,
    public readonly password: string,
    public readonly context: AuthSessionContext = {},
  ) {}
}
