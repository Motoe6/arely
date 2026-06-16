import type { WorkerRegistry } from "./registry.js";
import type { CoordinatorConfig } from "./types.js";
import { newCorrelationId } from "./types.js";

export class HeartbeatManager {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private registry: WorkerRegistry;
  private config: CoordinatorConfig;
  private onTimeout: (workerId: string) => void;
  private log: (msg: string) => void;

  constructor(
    registry: WorkerRegistry,
    config: CoordinatorConfig,
    onTimeout: (workerId: string) => void,
    log?: (msg: string) => void,
  ) {
    this.registry = registry;
    this.config = config;
    this.onTimeout = onTimeout;
    this.log = log ?? (() => {});
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.check(), this.config.heartbeatIntervalMs);
    this.log(`Heartbeat monitor started (interval=${this.config.heartbeatIntervalMs}ms, timeout=${this.config.heartbeatTimeoutMs}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private check(): void {
    const now = Date.now();
    for (const entry of this.registry.getAll()) {
      const elapsed = now - entry.lastHeartbeat;
      if (elapsed > this.config.heartbeatTimeoutMs && entry.status !== "offline") {
        this.log(`Heartbeat timeout for worker ${entry.worker.workerId} (${elapsed}ms)`);
        this.registry.markOffline(entry.worker.workerId);
        this.onTimeout(entry.worker.workerId);
      }
    }
  }

  // Called when a heartbeat ping is received from a worker
  handlePing(workerId: string, activeRoles: number, memoryMb: number): { type: "heartbeat_pong"; correlationId: string; timestamp: number } {
    this.registry.updateHeartbeat(workerId, activeRoles, memoryMb);
    return {
      type: "heartbeat_pong",
      correlationId: newCorrelationId(),
      timestamp: Date.now(),
    };
  }
}
