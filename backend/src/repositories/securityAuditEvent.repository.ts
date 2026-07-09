import { injectable } from "tsyringe";
import { FilterQuery } from "mongoose";
import { ISecurityAuditEvent } from "@/types";
import { SecurityAuditEventModel } from "@/models/securityAuditEvent.model";
import { Errors } from "@/utils/errors";

@injectable()
export class SecurityAuditEventRepository {
  private readonly model = SecurityAuditEventModel;

  async create(item: Partial<ISecurityAuditEvent>): Promise<ISecurityAuditEvent> {
    try {
      const doc = new this.model(item);
      return await doc.save();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findLatest(): Promise<ISecurityAuditEvent | null> {
    try {
      return this.model
        .findOne()
        .sort({ occurredAt: -1, _id: -1 })
        .lean<ISecurityAuditEvent>()
        .exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findForArchiveDate(date: string): Promise<ISecurityAuditEvent[]> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    return this.findForArchiveRange({ occurredAt: { $gte: start, $lte: end } });
  }

  async findForArchiveRange(
    filter: FilterQuery<ISecurityAuditEvent>,
  ): Promise<ISecurityAuditEvent[]> {
    try {
      return this.model
        .find(filter)
        .sort({ occurredAt: 1, _id: 1 })
        .lean<ISecurityAuditEvent[]>()
        .exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }
}
