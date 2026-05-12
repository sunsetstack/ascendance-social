import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { Model } from "mongoose";
import { IUser, IUserPreference } from "@/types";
import { Errors , wrapError } from "@/utils/errors";
import { UserRepository } from "./user.repository";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UserPreferenceRepository extends BaseRepository<IUserPreference> {
	constructor(
		@inject(TOKENS.Models.UserPreference) model: Model<IUserPreference>,
		@inject(TOKENS.Repositories.User) private userRepository: UserRepository
	) {
		super(model);
	}

	async getTopUserTags(userId: string, limit = 5): Promise<IUserPreference[]> {
		try {
			return this.model.find({ userId }).sort({ score: -1 }).limit(limit).exec();
		} catch (error) {
			console.error(error);
			if (error instanceof Error) {
				throw wrapError(error);
			} else {
				throw Errors.internal(String(error));
			}
		}
	}

	async incrementTagScore(userId: string, tag: string, increment: number): Promise<IUserPreference> {
		try {
			return this.model.findOneAndUpdate(
				{ userId, tag },
				{
					$inc: { score: increment },
					$set: { lastInteraction: new Date() },
				},
				{ upsert: true, new: true }
			);
		} catch (error) {
			console.error(error);
			if (error instanceof Error) {
				throw wrapError(error);
			} else {
				throw Errors.internal(String(error));
			}
		}
	}

	async decrementTagScore(userId: string, tag: string, decrement: number): Promise<IUserPreference> {
		return this.model.findOneAndUpdate(
			{ userId, tag },
			{
				$inc: { score: -decrement },
				$set: { lastInteraction: new Date() },
			},
			{ upsert: true, new: true }
		);
	}

	async getUsersWithTagPreferences(tags: string[], minScore: number = 1): Promise<IUser[]> {
		try {
			const preferences = await this.model
				.find({
					tag: { $in: tags },
					score: { $gte: minScore },
				})
				.exec();

			const userIds = [...new Set(preferences.map((pref) => pref.userId))];

			return await this.userRepository
				.find({
					_id: { $in: userIds },
				})
				.exec();
		} catch (error) {
			if (error instanceof Error) {
				throw wrapError(error);
			}
			throw Errors.internal(String(error));
		}
	}

	async deleteManyByUserId(userId: string): Promise<number> {
		try {
			const session = this.getSession();
			const result = await this.model
				.deleteMany({ userId })
				.session(session || null)
				.exec();
			return result.deletedCount || 0;
		} catch (error) {
			console.error(error);
			if (error instanceof Error) {
				throw wrapError(error);
			} else {
				throw Errors.internal(String(error));
			}
		}
	}
}
