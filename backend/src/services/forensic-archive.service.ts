import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { IForensicOperationalErrorReader } from "@/repositories/interfaces";
import type { ForensicOperationalErrorRecord } from "@/types";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const GENESIS_HASH = "0".repeat(64);
const ARCHIVE_VERSION = 1;
const ARCHIVE_TYPE = "forensic-operational-errors";

type JsonObject = Record<string, unknown>;

type ForensicArchiveManifest = {
  version: 1;
  archiveType: typeof ARCHIVE_TYPE;
  date: string;
  windowStart: string;
  windowEnd: string;
  ordering: ["recordedAt", "eventId"];
  createdAt: string;
  eventCount: number;
  firstEventId?: string;
  lastEventId?: string;
  firstEventHash?: string;
  finalEventHash: string;
  recordsSha256: string;
};

type ForensicArchiveEvent = {
  record: JsonObject;
  previousHash: string;
  eventHash: string;
};

type ForensicArchiveBundle = {
  manifest: ForensicArchiveManifest;
  events: ForensicArchiveEvent[];
};

type EncryptionEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

export interface ForensicArchiveConfig {
  archiveDirectory: string;
  encryptionKey: Buffer;
}

export interface ForensicArchiveResult {
  archivePath: string;
  archiveSha256: string;
  eventCount: number;
  reusedExistingArchive: boolean;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeForJson(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item));
  }

  if (value && typeof value === "object") {
    const maybeObjectId = value as { toHexString?: () => string };
    if (typeof maybeObjectId.toHexString === "function") {
      return maybeObjectId.toHexString();
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, normalizeForJson(item)] as const)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareStrings(left, right));
    return Object.fromEntries(entries);
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function parseEncryptionKey(raw: string | undefined): Buffer {
  const normalized = raw?.trim();
  if (!normalized) {
    throw new Error(
      "FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64 is required for forensic sealing",
    );
  }

  const key = Buffer.from(normalized, "base64");
  const canonicalInput = normalized.replace(/=+$/, "");
  const canonicalDecoded = key.toString("base64").replace(/=+$/, "");
  if (key.length !== 32 || canonicalInput !== canonicalDecoded) {
    throw new Error(
      "FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64 must be valid base64 encoding exactly 32 bytes",
    );
  }

  return key;
}

export function readForensicArchiveConfigFromEnv(): ForensicArchiveConfig {
  return {
    archiveDirectory:
      process.env.FORENSIC_ARCHIVE_DIR ??
      path.join(process.cwd(), "forensic-archives"),
    encryptionKey: parseEncryptionKey(
      process.env.FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64,
    ),
  };
}

function utcWindow(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid UTC archive date: ${date}`);
  }

  const start = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid UTC archive date: ${date}`);
  }

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  if (end.getTime() > Date.now()) {
    throw new Error(`Forensic archive date is not a closed UTC day: ${date}`);
  }

  return { start, end };
}

function canonicalRecords(
  records: readonly ForensicOperationalErrorRecord[],
): JsonObject[] {
  return [...records]
    .sort((left, right) => {
      const timeDifference =
        left.recordedAt.getTime() - right.recordedAt.getTime();
      return timeDifference || compareStrings(left.eventId, right.eventId);
    })
    .map((record) => normalizeForJson(record) as JsonObject);
}

function buildBundle(
  date: string,
  start: Date,
  end: Date,
  records: JsonObject[],
): ForensicArchiveBundle {
  const recordsSha256 = sha256(stableStringify(records));
  let previousHash = GENESIS_HASH;
  const events = records.map((record) => {
    const eventHash = sha256(stableStringify({ record, previousHash }));
    const event = { record, previousHash, eventHash };
    previousHash = eventHash;
    return event;
  });

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  return {
    manifest: {
      version: ARCHIVE_VERSION,
      archiveType: ARCHIVE_TYPE,
      date,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      ordering: ["recordedAt", "eventId"],
      createdAt: new Date().toISOString(),
      eventCount: events.length,
      ...(typeof firstEvent?.record.eventId === "string"
        ? { firstEventId: firstEvent.record.eventId }
        : {}),
      ...(typeof lastEvent?.record.eventId === "string"
        ? { lastEventId: lastEvent.record.eventId }
        : {}),
      ...(firstEvent ? { firstEventHash: firstEvent.eventHash } : {}),
      finalEventHash: lastEvent?.eventHash ?? GENESIS_HASH,
      recordsSha256,
    },
    events,
  };
}

function encryptBundle(
  compressedBundle: Buffer,
  key: Buffer,
  archiveFileName: string,
): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(archiveFileName, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(compressedBundle),
    cipher.final(),
  ]);
  const envelope: EncryptionEnvelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
}

function parseEnvelope(value: unknown): EncryptionEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid forensic archive encryption envelope");
  }

  const envelope = value as Partial<EncryptionEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== "aes-256-gcm" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Invalid forensic archive encryption envelope");
  }

  return envelope as EncryptionEnvelope;
}

async function decryptBundle(
  encryptedArchive: Buffer,
  key: Buffer,
  archiveFileName: string,
): Promise<ForensicArchiveBundle> {
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(encryptedArchive.toString("utf8"));
  } catch {
    throw new Error("Invalid forensic archive encryption envelope");
  }

  const envelope = parseEnvelope(parsedEnvelope);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(archiveFileName, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  const plaintext = await gunzip(compressed);

  let bundle: unknown;
  try {
    bundle = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Invalid forensic archive bundle");
  }

  return bundle as ForensicArchiveBundle;
}

function verifyBundle(
  bundle: ForensicArchiveBundle,
  expectedDate: string,
  expectedStart: Date,
  expectedEnd: Date,
  expectedRecordsSha256: string,
): void {
  const manifest = bundle?.manifest;
  const events = bundle?.events;
  if (
    !manifest ||
    manifest.version !== ARCHIVE_VERSION ||
    manifest.archiveType !== ARCHIVE_TYPE ||
    manifest.date !== expectedDate ||
    manifest.windowStart !== expectedStart.toISOString() ||
    manifest.windowEnd !== expectedEnd.toISOString() ||
    !Array.isArray(manifest.ordering) ||
    manifest.ordering[0] !== "recordedAt" ||
    manifest.ordering[1] !== "eventId" ||
    !Array.isArray(events)
  ) {
    throw new Error(`Invalid forensic archive manifest for ${expectedDate}`);
  }

  const records = events.map((event) => event.record);
  const archivedRecordsSha256 = sha256(stableStringify(records));
  if (
    archivedRecordsSha256 !== manifest.recordsSha256 ||
    manifest.recordsSha256 !== expectedRecordsSha256 ||
    manifest.eventCount !== events.length
  ) {
    throw new Error(
      `Forensic sealed-day integrity conflict for ${expectedDate}`,
    );
  }

  let previousHash = GENESIS_HASH;
  for (const event of events) {
    if (
      !event ||
      typeof event !== "object" ||
      event.previousHash !== previousHash
    ) {
      throw new Error(`Invalid forensic archive chain for ${expectedDate}`);
    }

    const expectedEventHash = sha256(
      stableStringify({ record: event.record, previousHash }),
    );
    if (event.eventHash !== expectedEventHash) {
      throw new Error(`Invalid forensic archive chain for ${expectedDate}`);
    }
    previousHash = event.eventHash;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const firstEventId =
    typeof firstEvent?.record.eventId === "string"
      ? firstEvent.record.eventId
      : undefined;
  const lastEventId =
    typeof lastEvent?.record.eventId === "string"
      ? lastEvent.record.eventId
      : undefined;

  if (
    manifest.firstEventId !== firstEventId ||
    manifest.lastEventId !== lastEventId ||
    manifest.firstEventHash !== firstEvent?.eventHash ||
    manifest.finalEventHash !== previousHash
  ) {
    throw new Error(`Invalid forensic archive chain for ${expectedDate}`);
  }
}

async function writeAtomicallyExclusive(
  finalPath: string,
  contents: Buffer | string,
): Promise<boolean> {
  const temporaryPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, contents, { flag: "wx" });
  try {
    const handle = await fs.open(temporaryPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fs.link(temporaryPath, finalPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function ensureSha256Sidecar(
  archivePath: string,
  archiveSha256: string,
): Promise<void> {
  const sidecarPath = `${archivePath}.sha256`;
  const expected = `${archiveSha256}  ${path.basename(archivePath)}\n`;
  const existing = await fs
    .readFile(sidecarPath, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });

  if (existing !== undefined) {
    if (existing !== expected) {
      throw new Error(`Forensic archive checksum conflict: ${sidecarPath}`);
    }
    return;
  }

  const created = await writeAtomicallyExclusive(sidecarPath, expected);
  if (!created) {
    const racedValue = await fs.readFile(sidecarPath, "utf8");
    if (racedValue !== expected) {
      throw new Error(`Forensic archive checksum conflict: ${sidecarPath}`);
    }
  }
}

export class ForensicArchiveService {
  constructor(
    private readonly reader: IForensicOperationalErrorReader,
    private readonly config: ForensicArchiveConfig,
  ) {
    if (config.encryptionKey.length !== 32) {
      throw new Error("Forensic archive encryption key must be 32 bytes");
    }
  }

  async sealDate(date: string): Promise<ForensicArchiveResult> {
    const { start, end } = utcWindow(date);
    const persistedRecords = await this.reader.findRecordedBetween(start, end);
    const records = canonicalRecords(persistedRecords);
    const expectedRecordsSha256 = sha256(stableStringify(records));
    const archiveFileName = `forensic-${date}.v1.json.gz.enc`;
    const archivePath = path.join(
      this.config.archiveDirectory,
      archiveFileName,
    );
    await fs.mkdir(this.config.archiveDirectory, { recursive: true });

    const existingArchive = await fs
      .readFile(archivePath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });

    let archiveContents: Buffer;
    let reusedExistingArchive = false;
    if (existingArchive) {
      const existingBundle = await decryptBundle(
        existingArchive,
        this.config.encryptionKey,
        archiveFileName,
      );
      verifyBundle(existingBundle, date, start, end, expectedRecordsSha256);
      archiveContents = existingArchive;
      reusedExistingArchive = true;
    } else {
      const bundle = buildBundle(date, start, end, records);
      const compressedBundle = await gzip(
        Buffer.from(`${stableStringify(bundle)}\n`, "utf8"),
      );
      archiveContents = encryptBundle(
        compressedBundle,
        this.config.encryptionKey,
        archiveFileName,
      );
      const created = await writeAtomicallyExclusive(
        archivePath,
        archiveContents,
      );

      if (!created) {
        archiveContents = await fs.readFile(archivePath);
        const racedBundle = await decryptBundle(
          archiveContents,
          this.config.encryptionKey,
          archiveFileName,
        );
        verifyBundle(racedBundle, date, start, end, expectedRecordsSha256);
        reusedExistingArchive = true;
      }
    }

    const archiveSha256 = sha256(archiveContents);
    await ensureSha256Sidecar(archivePath, archiveSha256);
    return {
      archivePath,
      archiveSha256,
      eventCount: records.length,
      reusedExistingArchive,
    };
  }
}
