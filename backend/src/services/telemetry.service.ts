import { injectable } from "tsyringe";
import { logger } from "@/utils/winston";

interface TelemetryEvent {
  type:
    | "ttfi"
    | "scroll_depth"
    | "flow_start"
    | "flow_complete"
    | "flow_abandon";
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

interface ClientInfo {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

interface AggregatedMetrics {
  ttfi: {
    count: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  scrollDepth: {
    feedId: string;
    avgMaxDepth: number;
    reachedThresholds: Record<number, number>;
  }[];
  flows: {
    flowType: string;
    started: number;
    completed: number;
    abandoned: number;
    completionRate: number;
    avgDuration: number;
  }[];
}

// in-memory storage for aggregated metrics
// in production, this would go to a time-series database or analytics service
interface MetricsBucket {
  ttfiValues: number[];
  scrollDepths: Map<string, number[]>;
  flowStarts: Map<string, number>;
  flowCompletes: Map<string, { count: number; durations: number[] }>;
  flowAbandons: Map<string, { count: number; reasons: Map<string, number> }>;
}

@injectable()
export class TelemetryService {
  private currentBucket: MetricsBucket;
  private bucketStartTime: number;
  private readonly BUCKET_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ARRAY_SIZE = 10_000;
  private rotationTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.currentBucket = this.createEmptyBucket();
    this.bucketStartTime = Date.now();

    // rotate bucket periodically
    this.rotationTimer = setInterval(
      () => this.rotateBucket(),
      this.BUCKET_DURATION,
    );
  }

  dispose(): void {
    clearInterval(this.rotationTimer);
  }

  private createEmptyBucket(): MetricsBucket {
    return {
      ttfiValues: [],
      scrollDepths: new Map(),
      flowStarts: new Map(),
      flowCompletes: new Map(),
      flowAbandons: new Map(),
    };
  }

  private rotateBucket(): void {
    // log summary before rotating
    this.logBucketSummary();
    this.currentBucket = this.createEmptyBucket();
    this.bucketStartTime = Date.now();
  }

  private logBucketSummary(): void {
    const summary = this.computeSummary();
    logger.info("Telemetry bucket summary", {
      bucketDuration: Date.now() - this.bucketStartTime,
      ttfiSamples: summary.ttfi.count,
      ttfiAvg: summary.ttfi.avg,
      flowsTracked: summary.flows.length,
    });
  }

  async processEvents(
    events: TelemetryEvent[],
    clientInfo: ClientInfo,
  ): Promise<void> {
    for (const event of events) {
      this.processEvent(event, clientInfo);
    }
  }

  private processEvent(event: TelemetryEvent, _clientInfo: ClientInfo): void {
    switch (event.type) {
      case "ttfi":
        this.processTTFI(event);
        break;
      case "scroll_depth":
        this.processScrollDepth(event);
        break;
      case "flow_start":
        this.processFlowStart(event);
        break;
      case "flow_complete":
        this.processFlowComplete(event);
        break;
      case "flow_abandon":
        this.processFlowAbandon(event);
        break;
    }
  }

  private processTTFI(event: TelemetryEvent): void {
    const duration = event.data.duration as number;
    if (typeof duration === "number" && duration > 0 && duration < 60000) {
      if (this.currentBucket.ttfiValues.length < this.MAX_ARRAY_SIZE) {
        this.currentBucket.ttfiValues.push(duration);
      }
    }
  }

  private processScrollDepth(event: TelemetryEvent): void {
    const feedId = event.data.feedId as string;
    const depth = event.data.depth as number;

    if (!feedId || typeof depth !== "number") return;

    if (!this.currentBucket.scrollDepths.has(feedId)) {
      this.currentBucket.scrollDepths.set(feedId, []);
    }
    const depths = this.currentBucket.scrollDepths.get(feedId)!;
    if (depths.length < this.MAX_ARRAY_SIZE) {
      depths.push(depth);
    }
  }

  private processFlowStart(event: TelemetryEvent): void {
    const flowType = event.data.flowType as string;
    if (!flowType) return;

    const current = this.currentBucket.flowStarts.get(flowType) || 0;
    this.currentBucket.flowStarts.set(flowType, current + 1);
  }

  private processFlowComplete(event: TelemetryEvent): void {
    const flowType = event.data.flowType as string;
    const duration = event.data.duration as number;
    if (!flowType) return;

    if (!this.currentBucket.flowCompletes.has(flowType)) {
      this.currentBucket.flowCompletes.set(flowType, {
        count: 0,
        durations: [],
      });
    }

    const data = this.currentBucket.flowCompletes.get(flowType)!;
    data.count++;
    if (typeof duration === "number" && data.durations.length < this.MAX_ARRAY_SIZE) {
      data.durations.push(duration);
    }
  }

  private processFlowAbandon(event: TelemetryEvent): void {
    const flowType = event.data.flowType as string;
    const reason = (event.data.reason as string) || "unknown";
    if (!flowType) return;

    if (!this.currentBucket.flowAbandons.has(flowType)) {
      this.currentBucket.flowAbandons.set(flowType, {
        count: 0,
        reasons: new Map(),
      });
    }

    const data = this.currentBucket.flowAbandons.get(flowType)!;
    data.count++;
    data.reasons.set(reason, (data.reasons.get(reason) || 0) + 1);
  }

  private computeSummary(): AggregatedMetrics {
    const ttfiValues = [...this.currentBucket.ttfiValues].sort((a, b) => a - b);
    const ttfiCount = ttfiValues.length;

    const ttfi = {
      count: ttfiCount,
      avg:
        ttfiCount > 0
          ? Math.round(ttfiValues.reduce((a, b) => a + b, 0) / ttfiCount)
          : 0,
      p50: ttfiCount > 0 ? ttfiValues[Math.floor(ttfiCount * 0.5)] : 0,
      p90: ttfiCount > 0 ? ttfiValues[Math.floor(ttfiCount * 0.9)] : 0,
      p99: ttfiCount > 0 ? ttfiValues[Math.floor(ttfiCount * 0.99)] : 0,
    };

    const scrollDepth: AggregatedMetrics["scrollDepth"] = [];
    for (const [feedId, depths] of this.currentBucket.scrollDepths) {
      const avgMaxDepth =
        depths.length > 0
          ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length)
          : 0;

      const reachedThresholds: Record<number, number> = {};
      for (const threshold of [25, 50, 75, 90, 100]) {
        reachedThresholds[threshold] = depths.filter(
          (d) => d >= threshold,
        ).length;
      }

      scrollDepth.push({ feedId, avgMaxDepth, reachedThresholds });
    }

    const flows: AggregatedMetrics["flows"] = [];
    const allFlowTypes = new Set([
      ...this.currentBucket.flowStarts.keys(),
      ...this.currentBucket.flowCompletes.keys(),
      ...this.currentBucket.flowAbandons.keys(),
    ]);

    for (const flowType of allFlowTypes) {
      const started = this.currentBucket.flowStarts.get(flowType) || 0;
      const completeData = this.currentBucket.flowCompletes.get(flowType) || {
        count: 0,
        durations: [],
      };
      const abandonData = this.currentBucket.flowAbandons.get(flowType) || {
        count: 0,
        reasons: new Map(),
      };

      const avgDuration =
        completeData.durations.length > 0
          ? Math.round(
              completeData.durations.reduce((a, b) => a + b, 0) /
                completeData.durations.length,
            )
          : 0;

      flows.push({
        flowType,
        started,
        completed: completeData.count,
        abandoned: abandonData.count,
        completionRate:
          started > 0 ? Math.round((completeData.count / started) * 100) : 0,
        avgDuration,
      });
    }

    return { ttfi, scrollDepth, flows };
  }

  async getSummary(): Promise<AggregatedMetrics & { bucketAge: number }> {
    return {
      ...this.computeSummary(),
      bucketAge: Date.now() - this.bucketStartTime,
    };
  }
}
