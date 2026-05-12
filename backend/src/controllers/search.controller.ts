import { Request, Response } from "express";
import { SearchService } from "@/services/search.service";
import { Errors } from "@/utils/errors";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class SearchController {
  constructor(
    @inject(TOKENS.Services.Search) private readonly searchService: SearchService,
  ) {}

  searchAll = async (req: Request, res: Response) => {
    const { q } = req.query;

    const queryValue = String(q || "");
    if (!queryValue.trim()) {
      throw Errors.validation('Query parameter "q" is required');
    }

    const searchTerms = queryValue.split(",").reduce<string[]>((acc, term) => {
      const trimmed = term.trim();
      if (!trimmed) {
        return acc;
      }

      acc.push(sanitizeTextInput(trimmed, 100));

      return acc;
    }, []);

    if (searchTerms.length === 0) {
      throw Errors.validation('Query parameter "q" is required');
    }

    const result = await this.searchService.searchAll(searchTerms);

    res.status(200).json({ success: true, data: result });
  };
}
