import { DatabaseConfig } from "@/config/dbConfig";
import { ForensicOperationalErrorRepository } from "@/repositories/forensicOperationalError.repository";
import {
  ForensicArchiveService,
  readForensicArchiveConfigFromEnv,
} from "@/services/forensic-archive.service";

function yesterdayUtc(): string {
  const now = new Date();
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return yesterday.toISOString().slice(0, 10);
}

function getDateArg(): string {
  const equalsArg = process.argv.find((arg) => arg.startsWith("--date="));
  if (equalsArg) return equalsArg.slice("--date=".length);

  const dateFlagIndex = process.argv.indexOf("--date");
  if (dateFlagIndex >= 0 && process.argv[dateFlagIndex + 1]) {
    return process.argv[dateFlagIndex + 1];
  }

  const positional = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  return positional ?? yesterdayUtc();
}

function applySealerMongoCredential(): void {
  const sealerMongoUri = process.env.FORENSIC_SEALER_MONGODB_URI?.trim();
  if (sealerMongoUri) {
    process.env.MONGODB_URI = sealerMongoUri;
  }
}

async function main(): Promise<void> {
  const config = readForensicArchiveConfigFromEnv();
  applySealerMongoCredential();
  const database = new DatabaseConfig();
  await database.connect();

  try {
    const reader = new ForensicOperationalErrorRepository();
    const service = new ForensicArchiveService(reader, config);
    const result = await service.sealDate(getDateArg());
    console.log(
      JSON.stringify(
        {
          event: "forensic_operational_error.archive_sealed",
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await database.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
