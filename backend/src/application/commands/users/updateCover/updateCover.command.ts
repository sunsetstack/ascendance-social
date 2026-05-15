import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class UpdateCoverCommand implements ICommand {
  readonly type = "UpdateCoverCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly fileBuffer: Buffer,
    public readonly originalName?: string,
    public readonly mimeType?: string,
  ) {}
}
