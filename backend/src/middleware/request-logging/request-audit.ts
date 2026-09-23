import type { CommandBus } from "@/application/common/buses/command.bus";
import { LogAuthActivityCommand } from "@/application/commands/admin/logAuthActivity/logAuthActivity.command";
import { LogSecurityAuditCommand } from "@/application/commands/admin/logSecurityAudit/logSecurityAudit.command";
import type {
  SecurityAuditActor,
  SecurityAuditOutcome,
  SecurityAuditTarget,
} from "@/types";
import { logger } from "@/utils/winston";
import type { CompletedRequestContext } from "./completed-request-context";

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

export function dispatchRequestAudits(
  commandBus: CommandBus,
  context: CompletedRequestContext,
): void {
  dispatchAuthActivityLog(commandBus, context);
  dispatchSecurityAuditLog(commandBus, context);
}

function dispatchAuthActivityLog(
  commandBus: CommandBus,
  context: CompletedRequestContext,
): void {
  if (!context.authAction) {
    return;
  }

  const command = new LogAuthActivityCommand({
    action: context.authAction,
    ip: context.ip,
    origin: context.origin,
    referer: context.referer,
    userAgent: context.userAgent,
    clientFingerprint: context.clientFingerprint,
    clientFingerprintSchemaVersion: context.clientFingerprintSchemaVersion,
    aborted: context.aborted,
    route: context.route,
    statusCode: context.statusCode,
    responseTimeMs: context.responseTimeMs,
    correlationId: context.correlationId,
    clientRequestId: context.clientRequestId,
    clientBootId: context.clientBootId,
    clientRequestAttempt: context.clientRequestAttempt,
    axiosRetry: context.axiosRetry,
    previousClientRequestId: context.previousClientRequestId,
    causedByClientRequestId: context.causedByClientRequestId,
    authState: context.authState,
    authSource: context.authSource,
    sessionId: context.sessionId,
    tokenFamilyId: context.tokenFamilyId,
    userId: context.userId,
    authEmail: context.authEmail,
    authUsername: context.authUsername,
    authHandle: context.authHandle,
    refreshRotated: context.refreshRotated,
  });

  void commandBus.dispatch(command).catch((error) => {
    logger.error("Failed to persist auth activity log", {
      event: "admin.auth_activity_log.persist_failed",
      action: context.authAction,
      route: context.route,
      correlationId: context.correlationId,
      error,
    });
  });
}

function dispatchSecurityAuditLog(
  commandBus: CommandBus,
  context: CompletedRequestContext,
): void {
  const authAuditEventType = resolveAuthAuditEventType(
    context.authAction,
    context.statusCode,
  );
  const routeAuditMatch = authAuditEventType
    ? undefined
    : matchSecurityAuditRoute(
        context.method,
        context.route,
        context.userId,
      );
  const eventType = authAuditEventType ?? routeAuditMatch?.eventType;
  if (!eventType) {
    return;
  }

  const isAuthEvent = Boolean(authAuditEventType);
  const outcome = resolveSecurityAuditOutcome(
    context.statusCode,
    isAuthEvent,
  );
  const command = new LogSecurityAuditCommand({
    eventType,
    actor: buildSecurityAuditActor(context),
    target:
      routeAuditMatch?.target ??
      (context.userId ? { type: "user", id: context.userId } : undefined),
    request: {
      correlationId: context.correlationId,
      clientRequestId: context.clientRequestId,
      clientBootId: context.clientBootId,
      clientRequestAttempt: context.clientRequestAttempt,
      axiosRetry: context.axiosRetry,
      previousClientRequestId: context.previousClientRequestId,
      causedByClientRequestId: context.causedByClientRequestId,
      method: context.method,
      route: context.route,
      statusCode: context.statusCode,
      ip: context.ip,
      userAgent: context.userAgent,
      origin: context.origin,
    },
    session: {
      sessionId: context.sessionId,
      tokenFamilyId: context.tokenFamilyId,
      authSource: context.authSource,
    },
    outcome,
    reason: resolveSecurityAuditReason(
      context.statusCode,
      outcome,
      isAuthEvent,
    ),
    metadata: {
      authAction: context.authAction,
      authState: context.authState,
      refreshRotated: context.refreshRotated,
      ...routeAuditMatch?.metadata,
    },
  });

  void commandBus.dispatch(command).catch((error) => {
    logger.error("Failed to persist security audit event", {
      event: "security_audit.persist_failed",
      eventType,
      route: context.route,
      correlationId: context.correlationId,
      error,
    });
  });
}

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
  context: CompletedRequestContext,
): SecurityAuditActor {
  return {
    type:
      context.route.startsWith("/api/admin") && context.userId
        ? "admin"
        : context.userId
          ? "user"
          : "anonymous",
    userId: context.userId,
    email: context.authEmail,
    username: context.authUsername,
    handle: context.authHandle,
  };
}
