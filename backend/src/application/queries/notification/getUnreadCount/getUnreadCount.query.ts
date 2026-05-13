import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetUnreadCountQuery implements IQuery {
  public readonly type = 'GetUnreadCountQuery';
  constructor(public readonly userPublicId: string) {}
}
