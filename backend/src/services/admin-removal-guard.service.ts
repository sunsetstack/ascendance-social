import { Model } from "mongoose";
import { inject, injectable } from "tsyringe";

import { requireTransactionSession } from "@/database/UnitOfWork";
import {
  ADMIN_MUTATION_GUARD_ID,
  IAdminMutationGuard,
} from "@/models/admin-mutation-guard.model";
import { TOKENS } from "@/types/tokens";
import { Errors, isMongoDBDuplicateKeyError } from "@/utils/errors";

@injectable()
export class AdminRemovalGuardService {
  constructor(
    @inject(TOKENS.Models.AdminMutationGuard)
    private readonly guardModel: Model<IAdminMutationGuard>,
  ) {}

  async ensureInitialized(): Promise<void> {
    try {
      await this.guardModel
        .updateOne(
          { _id: ADMIN_MUTATION_GUARD_ID },
          { $setOnInsert: { version: 0 } },
          { upsert: true },
        )
        .exec();
    } catch (error: unknown) {
      if (!isMongoDBDuplicateKeyError(error)) {
        throw error;
      }

      const existingGuard = await this.guardModel
        .exists({ _id: ADMIN_MUTATION_GUARD_ID })
        .exec();
      if (!existingGuard) {
        throw error;
      }
    }
  }

  async touch(): Promise<void> {
    const session = requireTransactionSession();
    const result = await this.guardModel
      .updateOne(
        { _id: ADMIN_MUTATION_GUARD_ID },
        { $inc: { version: 1 } },
        { session },
      )
      .exec();

    if (result.matchedCount !== 1) {
      throw Errors.internal("Admin removal guard is not initialized");
    }
  }
}
