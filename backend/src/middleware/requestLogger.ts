import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { logger } from "@/utils/winston";

const stripPort = (raw: string): string => {
	const trimmed = raw.trim();
	if (trimmed.startsWith("[")) return trimmed; // dont touch IPv6
	const lastColon = trimmed.lastIndexOf(":");
	if (lastColon === -1) return trimmed;
	// Only strip if the part after the colon is a valid port number
	const maybePart = trimmed.slice(lastColon + 1);
	if (/^\d{1,5}$/.test(maybePart)) return trimmed.slice(0, lastColon);
	return trimmed;
};

const getClientIp = (req: Request): string => {
	const xff = req.headers["x-forwarded-for"];
	const forwardedIps =
		typeof xff === "string" && xff.trim()
			? xff
					.split(",")
					.map((value) => stripPort(value))
					.filter((value) => value.length > 0)
			: [];
	const firstForwardedIp = forwardedIps[0];

	const cfIp = req.headers["cf-connecting-ip"];
	if (typeof cfIp === "string" && cfIp.trim()) {
		const normalizedCfIp = stripPort(cfIp);
		if (firstForwardedIp && firstForwardedIp !== normalizedCfIp && forwardedIps.includes(normalizedCfIp)) {
			return firstForwardedIp;
		}
		return normalizedCfIp;
	}

	const trueClientIp = req.headers["true-client-ip"];
	if (typeof trueClientIp === "string" && trueClientIp.trim()) return stripPort(trueClientIp);

	const xRealIp = req.headers["x-real-ip"];
	if (typeof xRealIp === "string" && xRealIp.trim()) return stripPort(xRealIp);
	if (firstForwardedIp) return firstForwardedIp;

	return stripPort(req.ip || req.socket.remoteAddress || "unknown");
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
	const startTime = Date.now();

	res.on("finish", async () => {
		try {
			const route = (req.originalUrl || req.url).split("?")[0];

			if (route === "/health" || route.startsWith("/metrics") || route.startsWith("/telemetry")) {
				return;
			}

			const responseTimeMs = Date.now() - startTime;
			const userId = req.decodedUser?.publicId;
			const userAgent = req.get("user-agent");

			const commandBus = container.resolve<CommandBus>("CommandBus");

			const command = new LogRequestCommand({
				method: req.method,
				route,
				ip: getClientIp(req),
				statusCode: res.statusCode,
				responseTimeMs,
				userId,
				userAgent,
			});

			await commandBus.dispatch(command);
		} catch (error) {
			logger.error("Failed to log request:", { error });
		}
	});

	next();
};
