import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export type HandleSuggestionContext = "mention" | "search";

export class GetHandleSuggestionsQuery implements IQuery {
  readonly type = "GetHandleSuggestionsQuery";

  constructor(
    public readonly query: string,
    public readonly context: HandleSuggestionContext,
    public readonly limit: number = 8,
    public readonly viewerPublicId?: UserPublicId,
  ) {}
}
