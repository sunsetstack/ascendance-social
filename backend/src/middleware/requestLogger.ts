import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { container } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { TOKENS } from "@/types/tokens";
import {
  buildCompletedRequestContext,
  getRequestRoute,
  shouldSkipRequestLogging,
} from "./request-logging/completed-request-context";
import { dispatchRequestAudits } from "./request-logging/request-audit";
import { dispatchRequestLog } from "./request-logging/request-log-persistence";
import {
  dispatchUserActivityUpdate,
  UserActivityThrottle,
} from "./request-logging/user-activity-tracker";

let commandBus: CommandBus | null = null;

function getCommandBus(): CommandBus {
  if (!commandBus) {
    commandBus = container.resolve<CommandBus>(TOKENS.CQRS.Commands.Bus);
  }

  return commandBus;
}

function logRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  resolveCommandBus: () => CommandBus,
  activityThrottle: UserActivityThrottle,
): void {
  const startTime = Date.now();
  let persisted = false;

  const persist = (aborted: boolean): void => {
    if (persisted) {
      return;
    }
    persisted = true;

    const route = getRequestRoute(req);
    const isSuccessfulAdminAction =
      !aborted &&
      res.statusCode < 400 &&
      (route === "/api/admin" || route.startsWith("/api/admin/"));
    const isSuccessfulVisitorObservation =
      (route === "/telemetry" || route === "/api/telemetry") &&
      Boolean(req.visitorObservation) &&
      res.statusCode >= 200 &&
      res.statusCode < 300;
    if (shouldSkipRequestLogging(route) && !isSuccessfulVisitorObservation) {
      return;
    }

    const context = buildCompletedRequestContext(
      req,
      res,
      route,
      startTime,
      { aborted },
    );
    const resolvedCommandBus = resolveCommandBus();

    if (!isSuccessfulAdminAction) {
      dispatchRequestLog(resolvedCommandBus, context);
    }
    if (!aborted) {
      dispatchUserActivityUpdate(
        resolvedCommandBus,
        context,
        activityThrottle,
      );
      if (!isSuccessfulAdminAction) {
        dispatchRequestAudits(resolvedCommandBus, context);
      }
    }
  };

  res.once("finish", () => persist(false));
  res.once("close", () => {
    if (!res.writableFinished) {
      persist(true);
    }
  });

  next();
}

export function createRequestLogger(
  resolveCommandBus: () => CommandBus = getCommandBus,
): RequestHandler {
  const activityThrottle = new UserActivityThrottle();
  return (req, res, next) =>
    logRequest(req, res, next, resolveCommandBus, activityThrottle);
}

export const requestLogger = createRequestLogger();
