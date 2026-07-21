import { createServer, type Server } from "node:http";
import type { MetricsService } from "./metrics.service";

export interface MetricsHttpServerOptions {
  port: number;
  host?: string;
}

export function startMetricsHttpServer(
  metricsService: MetricsService,
  options: MetricsHttpServerOptions,
): Server {
  const host = options.host ?? "0.0.0.0";
  const { port } = options;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid metrics server port: ${port}`);
  }

  const server = createServer(async (req, res) => {
    const path = req.url?.split("?", 1)[0];

    if (req.method !== "GET" || path !== "/metrics") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found\n");
      return;
    }

    try {
      const metrics = await metricsService.getMetrics();

      res.statusCode = 200;
      res.setHeader("Content-Type", metricsService.getContentType());
      res.end(metrics);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Failed to collect metrics\n");

      console.error("Failed to collect Prometheus metrics", error);
    }
  });

  server.listen(port, host, () => {
    console.info(`Metrics server listening on http://${host}:${port}/metrics`);
  });

  server.on("error", (error) => {
    console.error("Metrics HTTP server error", error);
  });

  return server;
}
