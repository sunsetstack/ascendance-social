import mongoose, {
  ClientSession,
  FilterQuery,
  ModifyResult,
  UpdateQuery,
} from "mongoose";
import { IRepository } from "@/types";
import { handleMongoError } from "@/utils/errors";
import { sessionALS } from "@/database/UnitOfWork";

/**
 * BaseRepository provides generic CRUD operations for MongoDB models.
 * It serves as the foundation for all other repositories.
 * It exposes a getSessioon() method that retrieves the current Mongoose session from the AsyncLocalStorage context and passes it to subclasses
 */
export abstract class BaseRepository<
  T extends mongoose.Document,
> implements IRepository<T> {
  constructor(protected readonly model: mongoose.Model<T>) {}

  protected getSession(): ClientSession | undefined {
    return sessionALS.getStore() ?? undefined;
  }

  /**
   * Creates a new document in the database.
   * @param item - The data to create.
   * @returns The created document.
   */
  async create(item: Partial<T>): Promise<T> {
    try {
      const session = this.getSession();
      const doc = new this.model(item);
      return await doc.save({ session });
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Updates a document by ID.
   * @param id - The document ID to update.
   * @param item - The update operations.
   * @returns The updated document or null if not found.
   */
  async update(id: string, item: Partial<T>): Promise<T | null> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        id,
        { $set: item },
        { new: true },
      );
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Deletes a document by ID.
   * @param id - The document ID to delete.
   * @returns True if deleted, false otherwise.
   */
  async delete(id: string): Promise<boolean> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndDelete({ _id: id });
      if (session) query.session(session);
      const result = await query.exec();
      return result !== null;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Finds a document by ID.
   * @param id - The document ID to search for.
   * @returns The document or null if not found.
   */
  async findById(
    id: string,
    options?: { selectPassword?: boolean },
  ): Promise<T | null> {
    try {
      const session = this.getSession();
      const query = this.model.findById(id);
      if (session) query.session(session);
      if (options?.selectPassword) {
        query.select("+password");
      }
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  // Extend the Base repository with this method as I'll need it in
  // multiple repositories.
  // Using .lean() instead of adjusting the return type is out of the question as it causes horrors beyond my comprehension further down the line.
  async findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<T | ModifyResult<T> | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndUpdate(filter, update, { new: true });
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Counts documents matching the given filter.
   * @param filter - The query filter.
   * @returns The number of matching documents.
   */
  async countDocuments(filter: FilterQuery<T> = {}): Promise<number> {
    try {
      const session = this.getSession();
      const query = this.model.countDocuments(filter);
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }
}
