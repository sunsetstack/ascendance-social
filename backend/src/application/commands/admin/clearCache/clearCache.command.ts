import { ICommand } from "@/application/common/interfaces/command.interface";

export class ClearCacheCommand implements ICommand {
  readonly type = "ClearCacheCommand";

  constructor(public readonly pattern?: string) {}
}
