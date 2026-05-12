import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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

    server: {
      port: 5173,
      proxy: {
        // forward /api/* → API Gateway on :3000
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
          ws: true, // proxy websockets for socket.io
        },
        // forward /uploads/* → Gateway
        "/uploads": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
        },
        // forward socket.io
        "/socket.io": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  };
});
