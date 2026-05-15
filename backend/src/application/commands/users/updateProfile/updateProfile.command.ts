import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class UpdateProfileCommand implements ICommand {
  readonly type = "UpdateProfileCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly updates: {
      username?: string;
      bio?: string;
      handle?: string;
    },
  ) {}
}
