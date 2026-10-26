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

interface ScrollDepthAggregate {
  count: number;
  totalDepth: number;
  reachedThresholds: Record<number, number>;
}

interface FlowCompletionAggregate {
  count: number;
  totalDuration: number;
}

// in-memory storage for aggregated metrics
// in production, this would go to a time-series database or analytics service
interface MetricsBucket {
  ttfiValues: number[];
  scrollDepths: Map<string, ScrollDepthAggregate>;
  flowStarts: Map<string, number>;
  flowCompletes: Map<string, FlowCompletionAggregate>;
  flowAbandons: Map<string, number>;
  feedDimensions: Set<string>;
  flowDimensions: Set<string>;
  invalidEvents: number;
  coalescedDimensions: number;
  droppedSamples: number;
}

const SCROLL_THRESHOLDS = [25, 50, 75, 90, 100] as const;
const OTHER_DIMENSION = "__other__";
const CREATE_POST_FLOW_TYPE = "create_post";

@injectable()
export class TelemetryService {
  private currentBucket: MetricsBucket;
  private bucketStartTime: number;
  private readonly BUCKET_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_TTFI_SAMPLES = 10_000;
  private readonly MAX_FEED_DIMENSIONS = 128;
  private readonly MAX_FLOW_DIMENSIONS = 32;
  private readonly MAX_FEED_ID_LENGTH = 512;
  private readonly MAX_FLOW_TYPE_LENGTH = 64;
  private readonly MAX_FLOW_DURATION_MS = 60 * 60 * 1000;
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
      feedDimensions: new Set([OTHER_DIMENSION]),
      flowDimensions: new Set([OTHER_DIMENSION, CREATE_POST_FLOW_TYPE]),
      invalidEvents: 0,
      coalescedDimensions: 0,
      droppedSamples: 0,
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
      invalidEvents: this.currentBucket.invalidEvents,
      coalescedDimensions: this.currentBucket.coalescedDimensions,
      droppedSamples: this.currentBucket.droppedSamples,
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
      default:
        this.currentBucket.invalidEvents++;
    }
  }

  private processTTFI(event: TelemetryEvent): void {
    const duration = event.data.duration;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration >= 60_000
    ) {
      this.currentBucket.invalidEvents++;
      return;
    }

    if (this.currentBucket.ttfiValues.length >= this.MAX_TTFI_SAMPLES) {
      this.currentBucket.droppedSamples++;
      return;
    }

    this.currentBucket.ttfiValues.push(duration);
  }

  private processScrollDepth(event: TelemetryEvent): void {
    const feedId = this.normalizeDimension(
      event.data.feedId,
      this.MAX_FEED_ID_LENGTH,
    );
    const depth = event.data.depth;

    if (
      !feedId ||
      typeof depth !== "number" ||
      !Number.isFinite(depth) ||
      !Number.isInteger(depth) ||
      depth < 0 ||
      depth > 100
    ) {
      this.currentBucket.invalidEvents++;
      return;
    }

    const admittedFeedId = this.admitDimension(
      feedId,
      this.currentBucket.feedDimensions,
      this.MAX_FEED_DIMENSIONS,
    );
    if (!this.currentBucket.scrollDepths.has(admittedFeedId)) {
      this.currentBucket.scrollDepths.set(admittedFeedId, {
        count: 0,
        totalDepth: 0,
        reachedThresholds: { 25: 0, 50: 0, 75: 0, 90: 0, 100: 0 },
      });
    }

    const aggregate = this.currentBucket.scrollDepths.get(admittedFeedId)!;
    aggregate.count++;
    aggregate.totalDepth += depth;
    for (const threshold of SCROLL_THRESHOLDS) {
      if (depth >= threshold) {
        aggregate.reachedThresholds[threshold]++;
      }
    }
  }

  private processFlowStart(event: TelemetryEvent): void {
    const flowType = this.resolveFlowType(event.data.flowType);
    if (!flowType) {
      this.currentBucket.invalidEvents++;
      return;
    }

    const current = this.currentBucket.flowStarts.get(flowType) || 0;
    this.currentBucket.flowStarts.set(flowType, current + 1);
  }

  private processFlowComplete(event: TelemetryEvent): void {
    const normalizedFlowType = this.normalizeDimension(
      event.data.flowType,
      this.MAX_FLOW_TYPE_LENGTH,
    );
    const duration = event.data.duration;
    if (
      !normalizedFlowType ||
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > this.MAX_FLOW_DURATION_MS
    ) {
      this.currentBucket.invalidEvents++;
      return;
    }

    const flowType = this.admitDimension(
      normalizedFlowType,
      this.currentBucket.flowDimensions,
      this.MAX_FLOW_DIMENSIONS,
    );

    if (!this.currentBucket.flowCompletes.has(flowType)) {
      this.currentBucket.flowCompletes.set(flowType, {
        count: 0,
        totalDuration: 0,
      });
    }

    const data = this.currentBucket.flowCompletes.get(flowType)!;
    data.count++;
    data.totalDuration += duration;
  }

  private processFlowAbandon(event: TelemetryEvent): void {
    const flowType = this.resolveFlowType(event.data.flowType);
    if (!flowType) {
      this.currentBucket.invalidEvents++;
      return;
    }

    const current = this.currentBucket.flowAbandons.get(flowType) || 0;
    this.currentBucket.flowAbandons.set(flowType, current + 1);
  }

  private resolveFlowType(value: unknown): string | null {
    const flowType = this.normalizeDimension(
      value,
      this.MAX_FLOW_TYPE_LENGTH,
    );
    if (!flowType) return null;

    return this.admitDimension(
      flowType,
      this.currentBucket.flowDimensions,
      this.MAX_FLOW_DIMENSIONS,
    );
  }

  private normalizeDimension(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;

    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength
      ? normalized
      : null;
  }

  private admitDimension(
    dimension: string,
    admittedDimensions: Set<string>,
    maxDimensions: number,
  ): string {
    if (admittedDimensions.has(dimension)) return dimension;

    if (admittedDimensions.size < maxDimensions) {
      admittedDimensions.add(dimension);
      return dimension;
    }

    this.currentBucket.coalescedDimensions++;
    return OTHER_DIMENSION;
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
    for (const [feedId, aggregate] of this.currentBucket.scrollDepths) {
      const avgMaxDepth =
        aggregate.count > 0
          ? Math.round(aggregate.totalDepth / aggregate.count)
          : 0;

      scrollDepth.push({
        feedId,
        avgMaxDepth,
        reachedThresholds: { ...aggregate.reachedThresholds },
      });
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
        totalDuration: 0,
      };
      const abandoned = this.currentBucket.flowAbandons.get(flowType) || 0;

      const avgDuration =
        completeData.count > 0
          ? Math.round(completeData.totalDuration / completeData.count)
          : 0;

      flows.push({
        flowType,
        started,
        completed: completeData.count,
        abandoned,
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
