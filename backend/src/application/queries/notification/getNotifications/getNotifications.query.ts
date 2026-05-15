import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetNotificationsQuery implements IQuery {
  public readonly type = 'GetNotificationsQuery';
  constructor(
    public readonly userId: string,
    public readonly limit?: number,
    public readonly before?: number,
  ) {}
}
