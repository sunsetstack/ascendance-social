import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const WINDOWS_MONGO_SRV_FALLBACK_DNS = ["1.1.1.1", "8.8.8.8"];

const envPathCandidates = Array.from(
  new Set([
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../.env"),
  ]),
);

for (const envPath of envPathCandidates) {
  if (!fs.existsSync(envPath)) {
    continue;
  }

  dotenv.config({ path: envPath });
  break;
}

// .env.local overrides .env — written by scripts/pick-port.mjs before dev starts
const localEnvCandidates = Array.from(
  new Set([
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(__dirname, "../../../.env.local"),
  ]),
);

for (const envPath of localEnvCandidates) {
  if (!fs.existsSync(envPath)) {
    continue;
  }

  dotenv.config({ path: envPath, override: true });
  break;
}

const configuredDnsServers = process.env.DNS_SERVERS?.split(/[,\s]+/)
  .map((server) => server.trim())
  .filter((server) => server.length > 0);

if (configuredDnsServers && configuredDnsServers.length > 0) {
  dns.setServers(configuredDnsServers);
} else if (
  process.platform === "win32" &&
  process.env.MONGODB_URI?.startsWith("mongodb+srv://")
) {
  dns.setServers(WINDOWS_MONGO_SRV_FALLBACK_DNS);
}
