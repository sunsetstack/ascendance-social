import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const gzip = promisify(zlib.gzip);
const execFileAsync = promisify(execFile);

interface ParsedAuditEvent {
  eventId?: string;
  eventHash?: string;
  [key: string]: unknown;
}

interface ArchiveResult {
  archivePath: string;
  archiveSha256: string;
  copiedPaths: string[];
  rcloneRemotePath?: string;
}

function sha256(buffer: Buffer | string): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function yesterdayUtc(): string {
  const now = new Date();
  const previousDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return previousDay.toISOString().slice(0, 10);
}

function getDateArg(): string {
  const rawDateArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--date="))
      ?.slice("--date=".length) ?? process.argv[2];

  if (!rawDateArg) {
    return yesterdayUtc();
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDateArg)) {
    throw new Error("Use --date=YYYY-MM-DD");
  }

  return rawDateArg;
}

function auditLogDirectory(): string {
  return process.env.AUDIT_LOG_DIR ?? path.join(process.cwd(), "audit-logs");
}

function archiveDirectory(): string {
  return (
    process.env.AUDIT_ARCHIVE_DIR ??
    path.join(auditLogDirectory(), "archives")
  );
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAuditEvents(jsonl: string): ParsedAuditEvent[] {
  return jsonl
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ParsedAuditEvent;
      } catch (error) {
        throw new Error(
          `Invalid audit JSONL at line ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
}

function buildManifest(
  date: string,
  jsonl: Buffer,
  events: ParsedAuditEvent[],
): Record<string, unknown> {
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  return {
    version: 1,
    date,
    createdAt: new Date().toISOString(),
    sourceName: `audit-${date}.jsonl`,
    eventCount: events.length,
    firstEventId: firstEvent?.eventId,
    lastEventId: lastEvent?.eventId,
    firstEventHash: firstEvent?.eventHash,
    lastEventHash: lastEvent?.eventHash,
    jsonlSha256: sha256(jsonl),
  };
}

function encryptIfConfigured(payload: Buffer): {
  buffer: Buffer;
  extension: string;
  encrypted: boolean;
} {
  const keyRaw = process.env.AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64;

  if (!keyRaw) {
    return { buffer: payload, extension: ".json.gz", encrypted: false };
  }

  const key = Buffer.from(keyRaw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64 must decode to 32 bytes",
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelope = {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  return {
    buffer: Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8"),
    extension: ".json.gz.enc",
    encrypted: true,
  };
}

async function copyLocalArchive(
  archivePath: string,
  archiveFileName: string,
  archiveSha256: string,
  date: string,
): Promise<string[]> {
  const copyDirs = splitCsv(process.env.AUDIT_ARCHIVE_COPY_DIRS);
  const [year, month] = date.split("-");
  const copiedPaths: string[] = [];

  for (const copyDir of copyDirs) {
    const destinationDir = path.join(copyDir, year, month);
    const destinationPath = path.join(destinationDir, archiveFileName);
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.copyFile(archivePath, destinationPath);

    const copiedBuffer = await fs.readFile(destinationPath);
    const copiedSha256 = sha256(copiedBuffer);
    if (copiedSha256 !== archiveSha256) {
      throw new Error(`Archive copy checksum mismatch: ${destinationPath}`);
    }

    copiedPaths.push(destinationPath);
  }

  return copiedPaths;
}

async function copyRcloneArchive(
  archivePath: string,
  archiveFileName: string,
  date: string,
): Promise<string | undefined> {
  const remote = process.env.AUDIT_ARCHIVE_RCLONE_REMOTE;
  if (!remote) {
    return undefined;
  }

  const [year, month] = date.split("-");
  const remoteRoot = remote.replace(/\/+$/, "");
  const remotePath = `${remoteRoot}/${year}/${month}/${archiveFileName}`;
  const rcloneBinary = process.env.AUDIT_ARCHIVE_RCLONE_BIN ?? "rclone";

  await execFileAsync(rcloneBinary, ["copyto", archivePath, remotePath], {
    windowsHide: true,
  });

  return remotePath;
}

async function writeArchive(date: string): Promise<ArchiveResult | undefined> {
  const sourcePath = path.join(auditLogDirectory(), `audit-${date}.jsonl`);
  const sourceExists = await fs
    .access(sourcePath)
    .then(() => true)
    .catch(() => false);

  if (!sourceExists) {
    console.log(`No audit JSONL file found for ${date}`);
    return undefined;
  }

  const jsonl = await fs.readFile(sourcePath);
  const events = parseAuditEvents(jsonl.toString("utf8"));
  const manifest = buildManifest(date, jsonl, events);
  const bundle = Buffer.from(
    `${JSON.stringify({ manifest, events })}\n`,
    "utf8",
  );
  const compressedBundle = await gzip(bundle);
  const sealed = encryptIfConfigured(compressedBundle);
  const archiveFileName = `audit-${date}${sealed.extension}`;
  const archivePath = path.join(archiveDirectory(), archiveFileName);

  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, sealed.buffer, { flag: "wx" });

  const archiveSha256 = sha256(sealed.buffer);
  const copiedPaths = await copyLocalArchive(
    archivePath,
    archiveFileName,
    archiveSha256,
    date,
  );
  const rcloneRemotePath = await copyRcloneArchive(
    archivePath,
    archiveFileName,
    date,
  );
  const hasExternalCopy = copiedPaths.length > 0 || Boolean(rcloneRemotePath);

  if (process.env.AUDIT_ARCHIVE_DELETE_SOURCE === "true") {
    await fs.unlink(sourcePath);
  }

  if (
    process.env.AUDIT_ARCHIVE_DELETE_LOCAL_ARCHIVE === "true" &&
    hasExternalCopy
  ) {
    await fs.unlink(archivePath);
  }

  return {
    archivePath,
    archiveSha256,
    copiedPaths,
    rcloneRemotePath,
  };
}

async function main(): Promise<void> {
  const date = getDateArg();
  const result = await writeArchive(date);
  if (!result) {
    return;
  }

  console.log(
    JSON.stringify(
      {
        event: "security_audit.archive_sealed",
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
