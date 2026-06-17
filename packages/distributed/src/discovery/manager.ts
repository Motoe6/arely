import type { DiscoveryProvider } from "./provider.js";
import type { WorkerInfo } from "../types.js";
import type { WorkerRegistry } from "../registry.js";
import type { MetricEmitter } from "../metric-events.js";
import {
  METRIC_DISCOVERED_WORKERS_TOTAL,
  METRIC_WORKER_JOINS_TOTAL,
  METRIC_WORKER_LEAVES_TOTAL,
  METRIC_DISCOVERY_ERRORS_TOTAL,
  METRIC_DISCOVERY_LATENCY_MS,
} from "../metric-events.js";
import { trace, context, SpanKind } from "@opentelemetry/api";

export interface DiscoveryManagerConfig {
  refreshIntervalMs: number;
}

const DEFAULT_CONFIG: DiscoveryManagerConfig = {
  refreshIntervalMs: 30_000,
};

export class DiscoveryManager {
  private providers: DiscoveryProvider[];
  private registry: WorkerRegistry;
  private config: DiscoveryManagerConfig;
  private emit: MetricEmitter;
  private log: (msg: string) => void;
  private knownWorkers = new Map<string, WorkerInfo>();
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(
    providers: DiscoveryProvider[],
    registry: WorkerRegistry,
    config?: Partial<DiscoveryManagerConfig>,
    emit?: MetricEmitter,
    log?: (msg: string) => void,
  ) {
    this.providers = providers;
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emit = emit ?? (() => {});
    this.log = log ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const provider of this.providers) {
      provider.onJoin((worker) => this.handleJoin(provider.name, worker));
      provider.onLeave((workerId) => this.handleLeave(provider.name, workerId));
      await provider.start();
    }

    await this.refresh();

    this.refreshTimer = setInterval(() => this.refresh(), this.config.refreshIntervalMs);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    for (const provider of this.providers) {
      await provider.stop();
    }
  }

  private async refresh(): Promise<void> {
    const startMs = Date.now();
    const otelTracer = trace.getTracer("arely-discovery", "1.0.0");

    for (const provider of this.providers) {
      const span = otelTracer.startSpan(
        `discovery.${provider.name}.refresh`,
        { kind: SpanKind.INTERNAL },
      );

      try {
        const workers = await provider.refresh();
        const currentIds = new Set(workers.map((w) => w.workerId));

        // Detect joins: in new list but not in knownWorkers
        for (const w of workers) {
          if (!this.knownWorkers.has(w.workerId)) {
            this.handleJoin(provider.name, w);
          }
        }

        // Detect leaves: in knownWorkers but not in new list
        for (const [id] of this.knownWorkers) {
          if (!currentIds.has(id)) {
            this.handleLeave(provider.name, id);
          }
        }

        span.setAttributes({
          "discovery.provider": provider.name,
          "discovery.workers_count": workers.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit({ type: "counter", name: METRIC_DISCOVERY_ERRORS_TOTAL, labels: { provider: provider.name } });
        this.log(`Discovery error [${provider.name}]: ${msg}`);
        span.setAttributes({ "error": msg });
      } finally {
        const elapsedMs = Date.now() - startMs;
        this.emit({ type: "histogram", name: METRIC_DISCOVERY_LATENCY_MS, durationMs: elapsedMs, labels: { provider: provider.name } });
        span.end();
      }
    }
  }

  private handleJoin(providerName: string, worker: WorkerInfo): void {
    this.knownWorkers.set(worker.workerId, worker);
    this.registry.register(worker);
    this.emit({ type: "counter", name: METRIC_WORKER_JOINS_TOTAL, labels: { provider: providerName, workerId: worker.workerId } });
    this.emit({ type: "gauge", name: METRIC_DISCOVERED_WORKERS_TOTAL, value: this.knownWorkers.size });
    this.log(`Worker joined [${providerName}]: ${worker.workerId} at ${worker.host}:${worker.port}`);
  }

  private handleLeave(providerName: string, workerId: string): void {
    this.knownWorkers.delete(workerId);
    this.registry.markOffline(workerId);
    this.emit({ type: "counter", name: METRIC_WORKER_LEAVES_TOTAL, labels: { provider: providerName, workerId } });
    this.emit({ type: "gauge", name: METRIC_DISCOVERED_WORKERS_TOTAL, value: this.knownWorkers.size });
    this.log(`Worker left [${providerName}]: ${workerId}`);
  }

  getKnownWorkers(): Map<string, WorkerInfo> {
    return new Map(this.knownWorkers);
  }
}
