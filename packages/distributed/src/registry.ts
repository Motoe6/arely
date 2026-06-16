import type { RegistryEntry, WorkerInfo, WorkerStatus } from "./types.js";

export class WorkerRegistry {
  private entries = new Map<string, RegistryEntry>();
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  register(worker: WorkerInfo): RegistryEntry {
    const existing = this.entries.get(worker.workerId);
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
    return entry;
  }

  unregister(workerId: string): boolean {
    const existed = this.entries.has(workerId);
    this.entries.delete(workerId);
    if (existed) this.log(`Unregistered worker ${workerId}`);
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
      entry.lastHeartbeat = Date.now();
      entry.activeRoles = activeRoles;
      entry.status = "online";
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
    if (entry) {
      entry.status = "offline";
      this.log(`Worker ${workerId} marked offline`);
    }
  }

  markBusy(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry) entry.status = "busy";
  }

  markAvailable(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry) entry.status = "online";
  }

  incrementLeases(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry) entry.leases++;
  }

  decrementLeases(workerId: string): void {
    const entry = this.entries.get(workerId);
    if (entry && entry.leases > 0) entry.leases--;
  }

  getActiveWorkerCount(): number {
    return this.getOnline().length;
  }

  size(): number {
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
  }
}
