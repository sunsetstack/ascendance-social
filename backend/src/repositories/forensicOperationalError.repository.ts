import { injectable } from "tsyringe";
import { ForensicOperationalErrorModel } from "@/models/forensicOperationalError.model";
import type {
  IForensicOperationalErrorReader,
  IForensicOperationalErrorWriter,
} from "@/repositories/interfaces";
import type {
  ForensicOperationalErrorRecord,
  NewForensicOperationalErrorRecord,
} from "@/types";
import { Errors } from "@/utils/errors";

@injectable()
export class ForensicOperationalErrorRepository
  implements
    IForensicOperationalErrorWriter,
    IForensicOperationalErrorReader
{
  async append(record: NewForensicOperationalErrorRecord): Promise<void> {
    try {
      await ForensicOperationalErrorModel.create({
        ...record,
        recordedAt: new Date(),
      });
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findRecordedBetween(
    start: Date,
    end: Date,
  ): Promise<readonly ForensicOperationalErrorRecord[]> {
    try {
      return await ForensicOperationalErrorModel.find(
        { recordedAt: { $gte: start, $lt: end } },
        { _id: 0 },
      )
        .sort({ recordedAt: 1, eventId: 1 })
        .lean<ForensicOperationalErrorRecord[]>()
        .exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }
}
