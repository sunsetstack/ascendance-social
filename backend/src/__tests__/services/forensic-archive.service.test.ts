import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IForensicOperationalErrorReader } from "@/repositories/interfaces";
import {
  ForensicArchiveService,
  readForensicArchiveConfigFromEnv,
} from "@/services/forensic-archive.service";
import type { ForensicOperationalErrorRecord } from "@/types";

class MutableForensicReader implements IForensicOperationalErrorReader {
  constructor(public records: ForensicOperationalErrorRecord[]) {}

  async findRecordedBetween(
    start: Date,
    end: Date,
  ): Promise<readonly ForensicOperationalErrorRecord[]> {
    return this.records.filter(
      (record) => record.recordedAt >= start && record.recordedAt < end,
    );
  }
}

function record(
  eventId: string,
  recordedAt: string,
): ForensicOperationalErrorRecord {
  return {
    schemaVersion: 1,
    eventId,
    errorId: `error-${eventId}`,
    eventType: "operational.error",
    occurredAt: new Date(recordedAt),
    recordedAt: new Date(recordedAt),
    severity: "error",
    operation: "safeFireAndForget",
    actor: { type: "system" },
    error: { name: "Error", message: `failure-${eventId}` },
  };
}

describe("ForensicArchiveService", () => {
  let archiveDirectory: string;

  beforeEach(async () => {
    archiveDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "ascendance-forensic-archive-"),
    );
  });

  afterEach(async () => {
    await fs.rm(archiveDirectory, { recursive: true, force: true });
  });

  it("creates and reuses an encrypted archive for an empty day", async () => {
    const reader = new MutableForensicReader([]);
    const service = new ForensicArchiveService(reader, {
      archiveDirectory,
      encryptionKey: Buffer.alloc(32, 7),
    });

    const first = await service.sealDate("2026-08-06");
    const second = await service.sealDate("2026-08-06");

    expect(first.eventCount).to.equal(0);
    expect(first.reusedExistingArchive).to.be.false;
    expect(second.reusedExistingArchive).to.be.true;
    expect(second.archiveSha256).to.equal(first.archiveSha256);
    expect(path.basename(first.archivePath)).to.equal(
      "forensic-2026-08-06.v1.json.gz.enc",
    );
    expect(await fs.readFile(`${first.archivePath}.sha256`, "utf8")).to.equal(
      `${first.archiveSha256}  forensic-2026-08-06.v1.json.gz.enc\n`,
    );
  });

  it("uses deterministic ordering and fails closed if a sealed day changes", async () => {
    const firstRecord = record("event-a", "2026-08-06T10:00:00.000Z");
    const secondRecord = record("event-b", "2026-08-06T11:00:00.000Z");
    const reader = new MutableForensicReader([secondRecord, firstRecord]);
    const service = new ForensicArchiveService(reader, {
      archiveDirectory,
      encryptionKey: Buffer.alloc(32, 9),
    });

    await service.sealDate("2026-08-06");
    reader.records = [firstRecord, secondRecord];
    const reused = await service.sealDate("2026-08-06");
    expect(reused.reusedExistingArchive).to.be.true;

    reader.records.push(record("event-c", "2026-08-06T12:00:00.000Z"));
    let thrown: unknown;
    try {
      await service.sealDate("2026-08-06");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.contain(
      "sealed-day integrity conflict",
    );
  });

  it("requires a dedicated valid encryption key", () => {
    const previous = process.env.FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64;
    delete process.env.FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64;
    try {
      expect(() => readForensicArchiveConfigFromEnv()).to.throw(
        "FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64 is required",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64;
      } else {
        process.env.FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64 = previous;
      }
    }
  });

  it("refuses to seal an open UTC day", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const service = new ForensicArchiveService(
      new MutableForensicReader([]),
      {
        archiveDirectory,
        encryptionKey: Buffer.alloc(32, 3),
      },
    );

    let thrown: unknown;
    try {
      await service.sealDate(tomorrow);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.contain("not a closed UTC day");
  });
});
