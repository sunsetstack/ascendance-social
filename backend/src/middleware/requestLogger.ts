import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { logger } from "@/utils/winston";
import { getClientIp } from "@/utils/request-ip";
import { TOKENS } from "@/types/tokens";
import { getCorrelationId } from "@/runtime/request-context";

let commandBus: CommandBus | null = null;

function getCommandBus(): CommandBus {
  if (!commandBus) {
    commandBus = container.resolve<CommandBus>(TOKENS.CQRS.Commands.Bus);
  }

  return commandBus;
}

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = Date.now();

  res.once("finish", () => {
    const route = (req.originalUrl || req.url).split("?")[0];

    if (
      route === "/health" ||
      route.startsWith("/metrics") ||
      route.startsWith("/telemetry")
    ) {
      return;
    }

    const responseTimeMs = Date.now() - startTime;
    const userId = req.decodedUser?.publicId;
    const userAgent = req.get("user-agent");

    const command = new LogRequestCommand({
      method: req.method,
      route,
      ip: getClientIp(req),
      statusCode: res.statusCode,
      responseTimeMs,
      correlationId: req.correlationId ?? getCorrelationId(),
      userId,
      userAgent,
    });

    void getCommandBus()
      .dispatch(command)
      .catch((error) => {
        logger.error("Failed to log request", { error });
      });
  });

  next();
};
