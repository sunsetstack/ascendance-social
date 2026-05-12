import mongoose, { Model } from "mongoose";
import { ITag } from "@/types";
import { Errors } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { TOKENS } from "@/types/tokens";

@injectable()
export class TagRepository extends BaseRepository<ITag> {
	constructor(@inject(TOKENS.Models.Tag) model: Model<ITag>) {
		super(model);
	}

	/**
	 * Retrieves all tags from the database.
	 * @returns {Promise<ITag[] | null>} - A promise that resolves to an array of tags or null.
	 */
	async getAll(): Promise<ITag[] | null> {
		return this.model.find({}).exec();
	}

	/**
	 * Finds a tag by its name.
	 * @param {string} tag - The tag name to search for.
	 * @returns {Promise<ITag | null>} - A promise that resolves to the found tag or null if not found.
	 * @throws {Error} - Throws a 'DatabaseError' if the update operation fails.
	 */
	async findByTag(tag: string): Promise<ITag | null> {
		try {
			const session = this.getSession();
			const query = this.model.findOne({ tag }).populate("tag", "tag");

			if (session) query.session(session);
			return await query.exec();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw Errors.database(message);
		}
	}

	/**
	 * Searches for tags that match any of the given search queries.
	 * Uses case-insensitive regex matching for partial matches.
	 * @param {string[]} searchQueries - An array of search terms.
	 * @returns {Promise<ITag[]>} - A promise that resolves to an array of matching tags.
	 * @throws {Error} - Throws a 'DatabaseError' if the update operation fails.
	 */

	async searchTags(
		searchQueries: string[],
		options?: { limit?: number; minCount?: number },
	): Promise<ITag[]> {
		try {
			const session = this.getSession();
			const { limit = 50, minCount = 0 } = options || {};
			const searchText = searchQueries.join(" ");

			const query = this.model
				.find(
					{
						$text: { $search: searchText },
						count: { $gte: minCount }, //filter unpopular tags
					},
					{ score: { $meta: "textScore" } },
				)
				.sort({
					score: { $meta: "textScore" }, // relevance
					count: -1, // popularity
				})
				.limit(limit);

			if (session) query.session(session);
			return await query.exec();
		} catch (error: unknown) {
			throw Errors.database(error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Executes an aggregation pipeline on the Tag collection.
	 * @param pipeline - MongoDB aggregation pipeline stages.
	 * @returns Promise resolving to aggregation results.
	 */
	async aggregate<R>(pipeline: mongoose.PipelineStage[]): Promise<R[]> {
		try {
			const session = this.getSession();
			const aggregation = this.model.aggregate<R>(pipeline);
			if (session) aggregation.session(session);
			return await aggregation.exec();
		} catch (error: unknown) {
			throw Errors.database(error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Finds multiple tags by their names.
	 * @param {string[]} tags - The tag names to search for.
	 * @returns {Promise<ITag[]>} - A promise that resolves to an array of found tags.
	 * @throws {Error} - Throws a 'DatabaseError' if the operation fails.
	 */
	async findByTags(tags: string[]): Promise<ITag[]> {
		try {
			const session = this.getSession();
			const query = this.model.find({ tag: { $in: tags } });
			if (session) {
				query.session(session);
			}
			return await query.exec();
		} catch (error) {
			throw Errors.database("Failed to find tags", { cause: error });
		}
	}
}
