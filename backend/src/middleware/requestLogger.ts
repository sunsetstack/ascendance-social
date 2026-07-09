import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { LogAuthActivityCommand } from "@/application/commands/admin/logAuthActivity/logAuthActivity.command";
import { LogSecurityAuditCommand } from "@/application/commands/admin/logSecurityAudit/logSecurityAudit.command";
import { logger } from "@/utils/winston";
import { getClientIp } from "@/utils/request-ip";
import { TOKENS } from "@/types/tokens";
import { getCorrelationId } from "@/runtime/request-context";
import type {
  SecurityAuditActor,
  SecurityAuditOutcome,
  SecurityAuditTarget,
} from "@/types";

declare module "express-serve-static-core" {
  interface Request {
    authLogMetadata?: {
      authAction?: string;
      userId?: string;
      authEmail?: string;
      authUsername?: string;
      authHandle?: string;
      sessionId?: string;
      tokenFamilyId?: string;
      authState?: string;
      authSource?: string;
      refreshRotated?: boolean;
    };
    correlationId?: string;
    clientRequestId?: string;
    clientBootId?: string;
    clientRequestAttempt?: number;
    axiosRetry?: boolean;
    previousClientRequestId?: string;
    causedByClientRequestId?: string;
    authSource?: string;
  }
}

let commandBus: CommandBus | null = null;

function getCommandBus(): CommandBus {
  if (!commandBus) {
    commandBus = container.resolve<CommandBus>(TOKENS.CQRS.Commands.Bus);
  }

  return commandBus;
}

function resolveAuthState(
  configured: string | undefined,
  userId: string | undefined,
  statusCode: number,
): string {
  if (configured) {
    return configured;
  }

  if (userId) {
    return "authenticated";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "auth_failed";
  }

  return "anonymous";
}

function resolveAuthSource(
  configured: string | undefined,
  req: Request,
  userId: string | undefined,
): string {
  if (configured) {
    return configured;
  }

  if (req.authSource) {
    return req.authSource;
  }

  return userId ? "access_token" : "none";
}

interface SecurityAuditRouteMatch {
  eventType: string;
  target?: SecurityAuditTarget;
  metadata?: Record<string, unknown>;
}

interface SecurityAuditRouteRule {
  method: string;
  pattern: RegExp;
  eventType: string;
  targetType?: string;
  targetMatchIndex?: number;
  targetFromActor?: boolean;
  metadata?: (match: RegExpMatchArray) => Record<string, unknown>;
}

const AUTH_ACTION_EVENT_BASES: Record<string, string> = {
  email_verify: "auth.email_verified",
  login: "auth.login",
  logout: "auth.logout",
  password_reset: "auth.password_reset",
  password_reset_requested: "auth.password_reset_requested",
  refresh: "auth.refresh",
  register: "auth.register",
};

const SECURITY_AUDIT_ROUTE_RULES: readonly SecurityAuditRouteRule[] = [
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/user\/([^/]+)$/,
    eventType: "admin.user.deleted",
    targetType: "user",
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/user\/([^/]+)\/ban$/,
    eventType: "admin.user.banned",
    targetType: "user",
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/user\/([^/]+)\/unban$/,
    eventType: "admin.user.unbanned",
    targetType: "user",
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/user\/([^/]+)\/promote$/,
    eventType: "admin.user.promoted",
    targetType: "user",
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/user\/([^/]+)\/demote$/,
    eventType: "admin.user.demoted",
    targetType: "user",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/image\/([^/]+)$/,
    eventType: "admin.post.deleted",
    targetType: "post",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/comment\/([^/]+)$/,
    eventType: "admin.comment.deleted",
    targetType: "comment",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/user\/([^/]+)\/favorite\/([^/]+)$/,
    eventType: "admin.favorite.removed",
    targetType: "favorite",
    targetMatchIndex: 2,
    metadata: (match) => ({
      userPublicId: match[1],
      postPublicId: match[2],
    }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/cache$/,
    eventType: "admin.cache.cleared",
    targetType: "cache",
  },
  {
    method: "PUT",
    pattern: /^\/api\/users\/me\/change-password$/,
    eventType: "auth.password_changed",
    targetType: "user",
    targetFromActor: true,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/users\/me$/,
    eventType: "account.deleted",
    targetType: "user",
    targetFromActor: true,
  },
  {
    method: "PUT",
    pattern: /^\/api\/users\/me\/edit$/,
    eventType: "account.profile_updated",
    targetType: "user",
    targetFromActor: true,
  },
];

function resolveAuthAuditEventType(
  authAction: string | undefined,
  statusCode: number,
): string | undefined {
  if (!authAction) {
    return undefined;
  }

  const base = AUTH_ACTION_EVENT_BASES[authAction] ?? `auth.${authAction}`;
  return `${base}.${statusCode < 400 ? "succeeded" : "failed"}`;
}

function matchSecurityAuditRoute(
  method: string,
  route: string,
  actorUserId: string | undefined,
): SecurityAuditRouteMatch | undefined {
  const upperMethod = method.toUpperCase();

  for (const rule of SECURITY_AUDIT_ROUTE_RULES) {
    if (rule.method !== upperMethod) {
      continue;
    }

    const match = route.match(rule.pattern);
    if (!match) {
      continue;
    }

    const targetId =
      rule.targetFromActor && actorUserId
        ? actorUserId
        : match[rule.targetMatchIndex ?? 1];

    return {
      eventType: rule.eventType,
      target:
        rule.targetType || targetId
          ? { type: rule.targetType, id: targetId }
          : undefined,
      metadata: rule.metadata?.(match),
    };
  }

  return undefined;
}

function resolveSecurityAuditOutcome(
  statusCode: number,
  isAuthEvent: boolean,
): SecurityAuditOutcome {
  if (statusCode < 400) {
    return "success";
  }

  if (!isAuthEvent && (statusCode === 401 || statusCode === 403)) {
    return "blocked";
  }

  return "failure";
}

function resolveSecurityAuditReason(
  statusCode: number,
  outcome: SecurityAuditOutcome,
  isAuthEvent: boolean,
): string | undefined {
  if (outcome === "success") {
    return undefined;
  }

  if (isAuthEvent) {
    return "auth_failed";
  }

  if (statusCode === 401) {
    return "unauthenticated";
  }

  if (statusCode === 403) {
    return "forbidden";
  }

  return `http_${statusCode}`;
}

function buildSecurityAuditActor(
  route: string,
  userId: string | undefined,
  email: string | undefined,
  username: string | undefined,
  handle: string | undefined,
): SecurityAuditActor {
  return {
    type: route.startsWith("/api/admin") && userId
      ? "admin"
      : userId
        ? "user"
        : "anonymous",
    userId,
    email,
    username,
    handle,
  };
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
    const authMetadata = req.authLogMetadata ?? {};
    const userId = authMetadata.userId ?? req.decodedUser?.publicId;
    const authEmail = authMetadata.authEmail ?? req.decodedUser?.email;
    const authUsername = authMetadata.authUsername ?? req.decodedUser?.username;
    const authHandle = authMetadata.authHandle ?? req.decodedUser?.handle;
    const sessionId = authMetadata.sessionId ?? req.decodedUser?.sid;
    const tokenFamilyId = authMetadata.tokenFamilyId ?? sessionId;
    const authState = resolveAuthState(
      authMetadata.authState,
      userId,
      res.statusCode,
    );
    const authSource = resolveAuthSource(
      authMetadata.authSource,
      req,
      userId,
    );
    const correlationId = req.correlationId ?? getCorrelationId();
    const ip = getClientIp(req);
    const origin = req.get("origin");
    const referer = req.get("referer");
    const userAgent = req.get("user-agent");

    const command = new LogRequestCommand({
      method: req.method,
      route,
      ip,
      origin,
      referer,
      statusCode: res.statusCode,
      responseTimeMs,
      correlationId,
      userId,
      userAgent,
      authState,
      authSource,
      authAction: authMetadata.authAction,
      authEmail,
      authUsername,
      authHandle,
      sessionId,
      tokenFamilyId,
      clientRequestId: req.clientRequestId,
      clientBootId: req.clientBootId,
      clientRequestAttempt: req.clientRequestAttempt,
      axiosRetry: req.axiosRetry,
      previousClientRequestId: req.previousClientRequestId,
      causedByClientRequestId: req.causedByClientRequestId,
      refreshRotated: authMetadata.refreshRotated,
    });

    const commandBus = getCommandBus();
    void commandBus
      .dispatch(command)
      .catch((error) => {
        logger.error("Failed to log request", {
          event: "admin.request_log.persist_failed",
          method: req.method,
          route,
          correlationId,
          error,
        });
      });

    if (authMetadata.authAction) {
      const auditCommand = new LogAuthActivityCommand({
        action: authMetadata.authAction,
        ip,
        origin,
        referer,
        userAgent,
        route,
        statusCode: res.statusCode,
        responseTimeMs,
        correlationId,
        clientRequestId: req.clientRequestId,
        clientBootId: req.clientBootId,
        clientRequestAttempt: req.clientRequestAttempt,
        axiosRetry: req.axiosRetry,
        previousClientRequestId: req.previousClientRequestId,
        causedByClientRequestId: req.causedByClientRequestId,
        authState,
        authSource,
        sessionId,
        tokenFamilyId,
        userId,
        authEmail,
        authUsername,
        authHandle,
        refreshRotated: authMetadata.refreshRotated,
      });

      void commandBus.dispatch(auditCommand).catch((error) => {
        logger.error("Failed to persist auth activity log", {
          event: "admin.auth_activity_log.persist_failed",
          action: authMetadata.authAction,
          route,
          correlationId,
          error,
        });
      });
    }

    const authAuditEventType = resolveAuthAuditEventType(
      authMetadata.authAction,
      res.statusCode,
    );
    const routeAuditMatch = authAuditEventType
      ? undefined
      : matchSecurityAuditRoute(req.method, route, userId);
    const securityAuditEventType =
      authAuditEventType ?? routeAuditMatch?.eventType;

    if (securityAuditEventType) {
      const outcome = resolveSecurityAuditOutcome(
        res.statusCode,
        Boolean(authAuditEventType),
      );
      const reason = resolveSecurityAuditReason(
        res.statusCode,
        outcome,
        Boolean(authAuditEventType),
      );
      const actor = buildSecurityAuditActor(
        route,
        userId,
        authEmail,
        authUsername,
        authHandle,
      );
      const securityAuditCommand = new LogSecurityAuditCommand({
        eventType: securityAuditEventType,
        actor,
        target:
          routeAuditMatch?.target ??
          (userId ? { type: "user", id: userId } : undefined),
        request: {
          correlationId,
          clientRequestId: req.clientRequestId,
          clientBootId: req.clientBootId,
          clientRequestAttempt: req.clientRequestAttempt,
          axiosRetry: req.axiosRetry,
          previousClientRequestId: req.previousClientRequestId,
          causedByClientRequestId: req.causedByClientRequestId,
          method: req.method,
          route,
          statusCode: res.statusCode,
          ip,
          userAgent,
          origin,
          referer,
        },
        session: {
          sessionId,
          tokenFamilyId,
          authSource,
        },
        outcome,
        reason,
        metadata: {
          authAction: authMetadata.authAction,
          authState,
          refreshRotated: authMetadata.refreshRotated,
          ...routeAuditMatch?.metadata,
        },
      });

      void commandBus.dispatch(securityAuditCommand).catch((error) => {
        logger.error("Failed to persist security audit event", {
          event: "security_audit.persist_failed",
          eventType: securityAuditEventType,
          route,
          correlationId,
          error,
        });
      });
    }
  });

  next();
};
