import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inject, injectable } from "tsyringe";
import { SecurityAuditEventRepository } from "@/repositories/securityAuditEvent.repository";
import {
  SecurityAuditActor,
  SecurityAuditOutcome,
  SecurityAuditRequestContext,
  SecurityAuditSessionContext,
  SecurityAuditTarget,
} from "@/types";
import { TOKENS } from "@/types/tokens";
import { logger } from "@/utils/winston";

const GENESIS_HASH = "0".repeat(64);

export interface RecordSecurityAuditEventInput {
  eventId?: string;
  eventType: string;
  occurredAt?: Date;
  actor: SecurityAuditActor;
  target?: SecurityAuditTarget;
  request?: SecurityAuditRequestContext;
  session?: SecurityAuditSessionContext;
  outcome: SecurityAuditOutcome;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface SerializedSecurityAuditEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: SecurityAuditActor;
  target?: SecurityAuditTarget;
  request?: SecurityAuditRequestContext;
  session?: SecurityAuditSessionContext;
  outcome: SecurityAuditOutcome;
  reason?: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
}

function normalizeForJson(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeForJson(item))
      .filter((item) => item !== undefined);
  }

  if (value !== null && typeof value === "object") {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, normalizeForJson(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function auditLogDirectory(): string {
  return process.env.AUDIT_LOG_DIR ?? path.join(process.cwd(), "audit-logs");
}

function auditLogPath(occurredAt: Date): string {
  const date = occurredAt.toISOString().slice(0, 10);
  return path.join(auditLogDirectory(), `audit-${date}.jsonl`);
}

@injectable()
export class SecurityAuditService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    @inject(TOKENS.Repositories.SecurityAuditEvent)
    private readonly securityAuditEventRepository: SecurityAuditEventRepository,
  ) {}

  async record(input: RecordSecurityAuditEventInput): Promise<void> {
    const write = this.writeQueue.then(
      () => this.recordNow(input),
      () => this.recordNow(input),
    );

    this.writeQueue = write.catch((error) => {
      logger.error("Security audit write failed", {
        event: "security_audit.write_failed",
        eventType: input.eventType,
        error,
      });
    });

    await write;
  }

  private async recordNow(input: RecordSecurityAuditEventInput): Promise<void> {
    const occurredAt = input.occurredAt ?? new Date();
    const latestEvent = await this.securityAuditEventRepository.findLatest();
    const previousHash = latestEvent?.eventHash ?? GENESIS_HASH;
    const eventId = input.eventId ?? crypto.randomUUID();

    const hashPayload = normalizeForJson({
      eventId,
      eventType: input.eventType,
      occurredAt: occurredAt.toISOString(),
      actor: input.actor,
      target: input.target,
      request: input.request,
      session: input.session,
      outcome: input.outcome,
      reason: input.reason,
      metadata: input.metadata,
      previousHash,
    }) as Omit<SerializedSecurityAuditEvent, "eventHash">;
    const eventHash = sha256(stableStringify(hashPayload));
    const serializedEvent: SerializedSecurityAuditEvent = {
      ...hashPayload,
      eventHash,
    };

    await this.securityAuditEventRepository.create({
      ...serializedEvent,
      occurredAt,
    });
    await this.appendJsonlEvent(occurredAt, serializedEvent);
  }

  private async appendJsonlEvent(
    occurredAt: Date,
    event: SerializedSecurityAuditEvent,
  ): Promise<void> {
    const filePath = auditLogPath(occurredAt);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
