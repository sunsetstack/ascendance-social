import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import { UserActionService } from "@/services/userAction.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

let userActionService: UserActionService | null = null;

function getUserActionService(): UserActionService {
	if (!userActionService) {
		userActionService = container.resolve<UserActionService>(TOKENS.Services.UserAction);
	}

	return userActionService;
}

export function logUserAction(req: Request, res: Response, next: NextFunction): void {
	const userId = req?.decodedUser?.publicId;
	const actionType = req.route.path;
	const targetId = req.params.id;

	if (!userId) {
		next();
		return;
	}

	getUserActionService().logUserAction(userId, actionType, targetId).catch((err) => {
		logger.warn("Failed to log user action", {
			error: err instanceof Error ? err.message : String(err),
			actionType,
			targetId,
			userId,
		});
	});
	next();
}
