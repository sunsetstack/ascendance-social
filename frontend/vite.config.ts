import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { appendFileSync, mkdirSync } from "node:fs";

const vendorChunkGroups: Array<[string, string[]]> = [
  [
    "react-vendor",
    [
      "react-dom",
      "react-router-dom",
      "react-router",
      "react-redux",
      "@reduxjs",
      "react",
      "scheduler",
    ],
  ],
  ["query-vendor", ["@tanstack"]],
  [
    "socket-vendor",
    [
      "socket.io-client",
      "engine.io-client",
      "socket.io-parser",
      "engine.io-parser",
      "@socket.io/component-emitter",
      "parseuri",
    ],
  ],
  ["charts-vendor", ["recharts", "d3-", "decimal.js", "eventemitter3"]],
  ["motion-vendor", ["framer-motion", "motion-dom", "motion-utils"]],
  ["crop-vendor", ["react-image-crop"]],
  ["date-vendor", ["date-fns"]],
  ["toast-vendor", ["react-toastify"]],
  [
    "i18n-vendor",
    ["i18next", "react-i18next", "i18next-browser-languagedetector"],
  ],
  ["seo-vendor", ["react-helmet-async"]],
];

const resolveManualChunk = (id: string): string | undefined => {
  const normalizedId = id.replace(/\\/g, "/");

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  for (const [chunkName, packages] of vendorChunkGroups) {
    if (
      packages.some((pkg) => normalizedId.includes(`/node_modules/${pkg}/`))
    ) {
      return chunkName;
    }
  }

  return undefined;
};

export default defineConfig(({ mode }) => {
  const { PORT: loadedPort } = loadEnv(mode, process.cwd(), "");
  const backendPort = process.env.PORT || loadedPort || "8000";
  const configureProxy: NonNullable<ProxyOptions["configure"]> = (proxy) => {
    proxy.on("error", (error, req) => {
      const failure = error as Error & { code?: string; errors?: Error[] };
      const record = JSON.stringify({
        timestamp: new Date().toISOString(), level: "error", traceSource: "vite",
        event: "dev.proxy.failed", method: req.method, path: req.url?.split("?")[0],
        target: `http://localhost:${backendPort}`, clientRequestId: req.headers["x-client-request-id"],
        code: failure.code, message: failure.message, stack: failure.stack,
        errors: failure.errors?.map((item) => ({ name: item.name, message: item.message, stack: item.stack,
          code: (item as Error & { code?: string }).code })),
      });
      console.error("[dev.proxy.failed]", record);
      try {
        const directory = path.resolve(__dirname, "logs");
        mkdirSync(directory, { recursive: true });
        appendFileSync(path.join(directory, "dev-proxy.log"), `${record}\n`);
      } catch (error) {
        console.error("[dev.proxy.log_failed]", error);
      }
    });
  };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: resolveManualChunk,
        },
      },
    },

    server: {
      port: 5173,
      proxy: {
        "/api": {
          configure: configureProxy,
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          secure: false,
          ws: true,
          proxyTimeout: 120_000,
          timeout: 120_000,
        },
        "/uploads": {
          configure: configureProxy,
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        "/socket.io": {
          configure: configureProxy,
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  };
});
