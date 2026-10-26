import type { ICommand } from "@/application/common/interfaces/command.interface";

export class UpdateInterestsCommand implements ICommand {
  readonly type = "UpdateInterestsCommand";
  constructor(
    public readonly userPublicId: string,
    public readonly action: "select" | "reset",
    public readonly selected: string[] = [],
  ) {}
}
