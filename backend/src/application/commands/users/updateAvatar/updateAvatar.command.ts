import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class UpdateAvatarCommand implements ICommand {
  readonly type = "UpdateAvatarCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly fileBuffer: Buffer,
    public readonly originalName?: string,
    public readonly mimeType?: string,
  ) {}
}
