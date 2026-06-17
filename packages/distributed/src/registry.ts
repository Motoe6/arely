import type { RegistryEntry, WorkerInfo, WorkerStatus } from "./types.js";
import type { MetricEmitter } from "./metric-events.js";
import {
  METRIC_WORKERS_TOTAL,
  METRIC_WORKERS_ONLINE,
  METRIC_WORKERS_BUSY,
  METRIC_WORKERS_DEGRADED,
  METRIC_WORKER_DISCONNECTS_TOTAL,
  METRIC_WORKER_STATE_TRANSITIONS_TOTAL,
} from "./metric-events.js";

export class WorkerRegistry {
  private entries = new Map<string, RegistryEntry>();
  private log: (msg: string) => void;
  private emit: MetricEmitter;

  constructor(emit?: MetricEmitter, log?: (msg: string) => void) {
    this.emit = emit ?? (() => {});
    this.log = log ?? (() => {});
  }

  private emitStateTransition(workerId: string, from: string, to: string): void {
    this.emit({ type: "counter", name: METRIC_WORKER_STATE_TRANSITIONS_TOTAL, labels: { workerId, from, to } });
  }

  register(worker: WorkerInfo): RegistryEntry {
    const existing = this.entries.get(worker.workerId);
    const prevStatus = existing?.status;
    const entry: RegistryEntry = {
      worker,
      status: "online",
      lastHeartbeat: Date.now(),
      activeRoles: existing?.activeRoles ?? 0,
      leases: existing?.leases ?? 0,
      avgLatencyMs: existing?.avgLatencyMs ?? 0,
      failureRate: existing?.failureRate ?? 0,
    };
    this.entries.set(worker.workerId, entry);
    this.log(`Registered worker ${worker.workerId} at ${worker.host}:${worker.port}`);
    this.emit({ type: "gauge", name: METRIC_WORKERS_TOTAL, value: this.entries.size });
    this.emit({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: this.getOnline().length });
    if (prevStatus && prevStatus !== "online") {
      this.emitStateTransition(worker.workerId, prevStatus, "online");
    }
    return entry;
  }

  unregister(workerId: string): boolean {
    const existed = this.entries.has(workerId);
    this.entries.delete(workerId);
    if (existed) {
      this.log(`Unregistered worker ${workerId}`);
      this.emit({ type: "gauge", name: METRIC_WORKERS_TOTAL, value: this.entries.size });
      this.emit({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: this.getOnline().length });
    }
    return existed;
  }

  get(workerId: string): RegistryEntry | undefined {
    return this.entries.get(workerId);
  }

  getAll(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  getOnline(): RegistryEntry[] {
    return this.getAll().filter((e) => e.status === "online");
  }

  getByCapability(capability: string): RegistryEntry[] {
    return this.getOnline().filter((e) => e.worker.capabilities.includes(capability as any));
  }

  getByProvider(provider: string): RegistryEntry[] {
    return this.getOnline().filter((e) => e.worker.providers.includes(provider));
  }

  updateHeartbeat(workerId: string, activeRoles: number, memoryMb: number): void {
    const entry = this.entries.get(workerId);
    if (entry) {
      const prevStatus = entry.status;
      entry.lastHeartbeat = Date.now();
      entry.activeRoles = activeRoles;
      entry.status = "online";
      if (prevStatus !== "online") {
        this.emitStateTransition(workerId, prevStatus, "online");
      }
    }
  }

  updateMetrics(workerId: string, avgLatencyMs: number, failureRate: number): void {
    const entry = this.entries.get(workerId);
    if (entry) {
      entry.avgLatencyMs = avgLatencyMs;
      entry.failureRate = failureRate;
    }
  }

  markOffline(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.status !== "offline") {
      const prevStatus = entry.status;
      entry.status = "offline";
      this.log(`Worker ${workerId} marked offline (was ${prevStatus})`);
      this.emit({ type: "counter", name: METRIC_WORKER_DISCONNECTS_TOTAL, labels: { workerId } });
      this.emit({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: this.getOnline().length });
      this.emitStateTransition(workerId, prevStatus, "offline");
    }
  }

  markBusy(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.status !== "busy") {
      const prevStatus = entry.status;
      entry.status = "busy";
      this.emit({ type: "gauge", name: METRIC_WORKERS_BUSY, value: this.getByStatus("busy").length });
      this.emitStateTransition(workerId, prevStatus, "busy");
    }
  }

  markAvailable(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.status !== "online") {
      const prevStatus = entry.status;
      entry.status = "online";
      this.emit({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: this.getOnline().length });
      this.emit({ type: "gauge", name: METRIC_WORKERS_BUSY, value: this.getByStatus("busy").length });
      this.emitStateTransition(workerId, prevStatus, "online");
    }
  }

  markDegraded(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.status !== "degraded") {
      const prevStatus = entry.status;
      entry.status = "degraded";
      this.log(`Worker ${workerId} marked degraded`);
      this.emit({ type: "gauge", name: METRIC_WORKERS_DEGRADED, value: this.getByStatus("degraded").length });
      this.emitStateTransition(workerId, prevStatus, "degraded");
    }
  }

  incrementLeases(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry) entry.leases++;
  }

  decrementLeases(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.leases > 0) entry.leases--;
  }

  getByStatus(status: string): RegistryEntry[] {
    return this.getAll().filter((e) => e.status === status);
  }

  getActiveWorkerCount(): number {
    return this.getOnline().length;
  }

  size(): number {
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
    this.emit({ type: "gauge", name: METRIC_WORKERS_TOTAL, value: 0 });
    this.emit({ type: "gauge", name: METRIC_WORKERS_ONLINE, value: 0 });
    this.emit({ type: "gauge", name: METRIC_WORKERS_BUSY, value: 0 });
    this.emit({ type: "gauge", name: METRIC_WORKERS_DEGRADED, value: 0 });
  }
}
