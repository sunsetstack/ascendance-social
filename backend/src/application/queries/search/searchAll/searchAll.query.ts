import { IQuery } from "@/application/common/interfaces/query.interface";

export class SearchAllQuery implements IQuery {
  public readonly type = 'SearchAllQuery';
  constructor(public readonly query: string[]) {}
}
