import { randomUUID } from "node:crypto";
import mongoose, { type Connection, type Model } from "mongoose";
import { OutboxModel, type IOutboxEvent } from "@/models/outbox.model";
import { OutboxRepository } from "@/repositories/outbox.repository";

export class OutboxTestDatabase {
  private connection: Connection | undefined;
  private testModel: Model<IOutboxEvent> | undefined;

  get model(): Model<IOutboxEvent> {
    if (!this.testModel) throw new Error("Outbox test database is not open");
    return this.testModel;
  }

  get repository(): OutboxRepository {
    return new OutboxRepository(this.model);
  }

  async open({
    createIndexes = true,
  }: { createIndexes?: boolean } = {}): Promise<void> {
    const uri = process.env.INTEGRATION_MONGODB_URI;
    if (!uri)
      throw new Error(
        "INTEGRATION_MONGODB_URI is required for Outbox integration tests",
      );
    this.connection = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    await this.connection.asPromise();
    const schema = OutboxModel.schema.clone();
    schema.set("autoIndex", createIndexes);
    this.testModel = this.connection.model<IOutboxEvent>(
      "OutboxTest",
      schema,
      `outbox_test_${randomUUID().replaceAll("-", "")}`,
    );
    await this.testModel.createCollection();
    await this.testModel.init();
  }

  async clear(): Promise<void> {
    await this.model.deleteMany({}).exec();
  }

  async close(): Promise<void> {
    try {
      if (this.testModel) await this.testModel.collection.drop();
    } finally {
      await this.connection?.close();
    }
  }
}
