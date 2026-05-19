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
  ["mui-vendor", ["@mui", "@emotion", "@popperjs"]],
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

  return "vendor";
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
