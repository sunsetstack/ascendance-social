import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetFavoritesQuery implements IQuery {
  public readonly type = 'GetFavoritesQuery';
  constructor(
    public readonly viewerPublicId: string,
    public readonly page: number | undefined,
    public readonly limit: number | undefined,
  ) {}
}
