import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(repositoryRoot, "backend");
const backendSourceRoot = path.join(backendRoot, "src");
const composeFile = path.join(repositoryRoot, "docker-compose.test.yml");
const composeProject = "ascendance-integration-tests";
const mongoPort = Number.parseInt(process.env.INTEGRATION_MONGO_PORT ?? "37017", 10);
const redisPort = Number.parseInt(process.env.INTEGRATION_REDIS_PORT ?? "36379", 10);
const dependencyTimeoutMs = 60_000;
const integrationTimeoutMs = 240_000;

let activeChild = null;

async function discoverIntegrationSuites(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverIntegrationSuites(absolutePath)));
      continue;
    }

    const relativePath = path.relative(backendRoot, absolutePath).split(path.sep).join("/");
    if (
      entry.isFile() &&
      relativePath.includes("/__tests__/integration/") &&
      relativePath.endsWith(".integration.test.ts")
    ) {
      files.push(relativePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function runCommand(command, args, { cwd = repositoryRoot, env = process.env, timeoutMs, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: quiet ? "ignore" : "inherit",
    });
    activeChild = child;

    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
        }, timeoutMs)
      : undefined;

    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      activeChild = null;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      activeChild = null;
      if (timedOut) {
        reject(new Error(`${command} exceeded its ${timeoutMs}ms deadline and was terminated`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
      }
    });
  });
}

async function waitForPort(name, port) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const finish = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(500, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not accept host connections on 127.0.0.1:${port} within 5 seconds`);
}

function composeArgs(...args) {
  return ["compose", "--project-name", composeProject, "--file", composeFile, ...args];
}

async function stopDependencies() {
  await runCommand(
    "docker",
    composeArgs("down", "--volumes", "--remove-orphans", "--timeout", "10"),
    { timeoutMs: 30_000, quiet: true },
  ).catch((error) => {
    console.error(`[integration] dependency cleanup failed: ${error.message}`);
  });
}

async function main() {
  const suites = await discoverIntegrationSuites(backendSourceRoot);
  if (suites.length === 0) {
    throw new Error("No backend integration suites were discovered under src/**/__tests__/integration");
  }

  console.log(`[integration] discovered ${suites.length} suite files:`);
  for (const suite of suites) console.log(`  - backend/${suite}`);

  if (process.argv.includes("--list")) return;

  try {
    await runCommand("docker", ["compose", "version"], {
      timeoutMs: 10_000,
      quiet: true,
    });
  } catch (error) {
    throw new Error(`Docker Compose is required for integration tests: ${error.message}`);
  }

  await stopDependencies();

  try {
    console.log("[integration] starting isolated Mongo replica set and Redis dependencies");
    await runCommand(
      "docker",
      composeArgs("up", "--detach", "--wait", "--wait-timeout", "60", "mongodb", "redis"),
      { timeoutMs: dependencyTimeoutMs },
    );
    await runCommand("docker", composeArgs("run", "--rm", "mongo-rs-init"), {
      timeoutMs: dependencyTimeoutMs,
    });
    await Promise.all([
      waitForPort("MongoDB", mongoPort),
      waitForPort("Redis", redisPort),
    ]);

    const mochaEntry = path.join(backendRoot, "node_modules", "mocha", "bin", "mocha.js");
    const testEnvironment = {
      ...process.env,
      NODE_ENV: "test",
      TS_NODE_PROJECT: "tsconfig.test.json",
      REDIS_AUTOCONNECT: "true",
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/ascendance_integration?replicaSet=rs0&directConnection=true`,
      INTEGRATION_MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/ascendance_integration?replicaSet=rs0&directConnection=true`,
    };

    console.log(`[integration] running all ${suites.length} discovered suites (deadline: ${integrationTimeoutMs / 1000}s)`);
    await runCommand(
      process.execPath,
      [
        mochaEntry,
        "--no-config",
        "--require",
        "tsx",
        "--require",
        "src/__tests__/setup.ts",
        "--timeout",
        "30000",
        "--reporter",
        "spec",
        ...suites,
      ],
      {
        cwd: backendRoot,
        env: testEnvironment,
        timeoutMs: integrationTimeoutMs,
      },
    );
  } finally {
    console.log("[integration] stopping isolated test dependencies");
    await stopDependencies();
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (activeChild) activeChild.kill("SIGTERM");
  });
}

main().catch((error) => {
  console.error(`[integration] FAILED: ${error.message}`);
  process.exitCode = 1;
});
