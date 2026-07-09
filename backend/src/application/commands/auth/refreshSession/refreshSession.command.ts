import { AuthSessionContext } from "@/services/auth.service";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class RefreshSessionCommand implements ICommand {
  readonly type = "RefreshSessionCommand";

  constructor(
    public readonly refreshToken: string,
    public readonly context: AuthSessionContext = {},
  ) {}
}
