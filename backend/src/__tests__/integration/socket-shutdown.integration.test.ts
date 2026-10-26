import { expect } from "chai";
import { spawn } from "node:child_process";
import path from "node:path";

describe("Socket.IO Redis shutdown", function () {
  this.timeout(15_000);

  for (const mode of ["delayed", "ordinary", "repeat", "external-http"] as const) {
    it(`closes owned subscribers without unhandled rejections during ${mode} shutdown`, async () => {
      const url = process.env.SOCKET_SHUTDOWN_TEST_REDIS_URL ?? process.env.REDIS_URL;
      if (!url) throw new Error("Set SOCKET_SHUTDOWN_TEST_REDIS_URL to isolated Redis");
      const fixture = path.resolve(__dirname, "../fixtures/socket-shutdown.ts");
      const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--require", "tsx", fixture, mode], {
          cwd: path.resolve(__dirname, "../../.."),
          env: { ...process.env, NODE_ENV: "test", REDIS_AUTOCONNECT: "false", REDIS_URL: url,
            ALLOWED_ORIGINS: "https://shutdown.example.com" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        const deadline = setTimeout(() => child.kill(), 12_000);
        child.once("error", (error) => { clearTimeout(deadline); reject(error); });
        child.once("exit", (code) => { clearTimeout(deadline); resolve({ code, output }); });
      });
      expect(result.code, result.output).to.equal(0);
      expect(result.output).to.include('"adapterUnsubscribeCommands":4,"hardDisconnectCalls":0');
      expect(result.output).to.include("Socket shutdown completed without unhandled rejections");
    });
  }
});
