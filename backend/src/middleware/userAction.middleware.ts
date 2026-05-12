import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import { UserActionService } from "@/services/userAction.service";

export function logUserAction(req: Request, res: Response, next: NextFunction): void {
	const userId = req?.decodedUser?.publicId;
	const actionType = req.route.path;
	const targetId = req.params.id;

	if (!userId) {
		next();
		return;
	}

	const userActionService = container.resolve<UserActionService>("UserActionService");
	userActionService.logUserAction(userId, actionType, targetId).catch((err) => {
		// fire-and-forget: don't block the request pipeline for logging
		void err;
	});
	next();
}
