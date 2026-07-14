import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // Allows using processs.env
    define: {
      "process.env": JSON.stringify(env),
    },
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
          target: `http://localhost:${env.PORT || 8000}`,
          changeOrigin: true,
          secure: false,
          ws: true,
          proxyTimeout: 120_000,
          timeout: 120_000,
        },
        "/uploads": {
          target: `http://localhost:${env.PORT || 8000}`,
          changeOrigin: true,
          secure: false,
        },
        "/socket.io": {
          target: `http://localhost:${env.PORT || 8000}`,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  };
});
