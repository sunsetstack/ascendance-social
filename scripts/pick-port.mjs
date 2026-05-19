/**
 * Finds the first available port from the candidate list by actually trying
 * to bind to it. This catches both in-use ports (EADDRINUSE) and Windows
 * Hyper-V/Docker reserved ranges (EACCES) without platform-specific parsing.
 *
 * Writes PORT=<chosen> to .env.local (root) and frontend/.env.local so that
 * both the backend (via bootstrap-env.ts) and Vite (via loadEnv) pick it up
 * before any process starts.
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CANDIDATES = [8000, 4000, 5000, 8080, 9000, 3500];

function testPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function pickPort() {
  for (const port of CANDIDATES) {
    if (await testPort(port)) {
      return port;
    }
    console.log(`[pick-port] Port ${port} unavailable, trying next…`);
  }
  throw new Error(
    `[pick-port] No available port found in candidates: ${CANDIDATES.join(", ")}`,
  );
}

const port = await pickPort();
const line = `PORT=${port}\n`;

fs.writeFileSync(path.join(ROOT, ".env.local"), line);
fs.writeFileSync(path.join(ROOT, "frontend", ".env.local"), line);

console.log(`[pick-port] Using port ${port}`);
