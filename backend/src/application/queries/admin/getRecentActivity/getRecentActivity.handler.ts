import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetRecentActivityQuery } from "./getRecentActivity.query";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { PaginationResult } from "@/types";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

export interface ActivityItem {
	userId: string;
	username: string;
	action: string;
	targetType: string;
	targetId: string;
	timestamp: Date;
}

@injectable()
export class GetRecentActivityQueryHandler
	implements IQueryHandler<GetRecentActivityQuery, PaginationResult<ActivityItem>>
{
	constructor(@inject(TOKENS.Repositories.UserAction) private readonly userActionRepository: UserActionRepository) {}

	async execute(query: GetRecentActivityQuery): Promise<PaginationResult<ActivityItem>> {
		const activities = await this.userActionRepository.findWithPagination({
			...query.options,
			sortBy: "timestamp",
			sortOrder: "desc",
		});

		const transformedData = activities.data.map((activity) => {
			const user = activity.userId as unknown as
				| { _id: mongoose.Types.ObjectId; username: string }
				| mongoose.Types.ObjectId;
			const userIdStr =
				user instanceof mongoose.Types.ObjectId ? user.toString() : user && "_id" in user ? user._id.toString() : "";
			const username = !(user instanceof mongoose.Types.ObjectId) && user?.username ? user.username : "Unknown";

			return {
				userId: userIdStr,
				username: username,
				action: activity.actionType || "unknown",
				targetType: this.getTargetType(activity.actionType),
				targetId: activity.targetId?.toString() || "",
				timestamp: activity.timestamp,
			};
		});

		return {
			data: transformedData,
			total: activities.total,
			page: activities.page,
			limit: activities.limit,
			totalPages: activities.totalPages,
		};
	}

	private getTargetType(actionType: string): string {
		const actionMap: Record<string, string> = {
			upload: "image",
			like: "image",
			comment: "image",
			follow: "user",
			unfollow: "user",
			favorite: "image",
			unfavorite: "image",
		};
		return actionMap[actionType] || "unknown";
	}
}
