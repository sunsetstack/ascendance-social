import { ICommand } from "@/application/common/interfaces/command.interface";

export class AddFavoriteCommand implements ICommand {
  public readonly type = 'AddFavoriteCommand';
  constructor(
    public readonly actorPublicId: string,
    public readonly postPublicId: string,
  ) {}
}
