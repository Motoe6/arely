import type { WorkerRegistry } from "./registry.js";
import type { LeaseManager } from "./lease-manager.js";
import type { RegistryEntry, ScheduleDecision, ScheduleStrategy } from "./types.js";

export class SwarmScheduler {
  private registry: WorkerRegistry;
  private leases: LeaseManager;
  private strategy: ScheduleStrategy;
  private roundRobinIndex = 0;

  constructor(
    registry: WorkerRegistry,
    leases: LeaseManager,
    strategy: ScheduleStrategy,
  ) {
    this.registry = registry;
    this.leases = leases;
    this.strategy = strategy;
  }

  setStrategy(strategy: ScheduleStrategy): void {
    this.strategy = strategy;
  }

  schedule(
    roleId: string,
    role: string,
    provider: string,
    requiredCapabilities?: string[],
  ): ScheduleDecision | null {
    const available = this.getCandidates(provider, requiredCapabilities);
    if (available.length === 0) return null;

    switch (this.strategy) {
      case "least_loaded":
        return this.leastLoaded(available);
      case "round_robin":
        return this.roundRobin(available);
      case "benchmark_aware":
        return this.benchmarkAware(available);
      case "capability_aware":
        return this.capabilityAware(available, requiredCapabilities);
      default:
        return this.leastLoaded(available);
    }
  }

  private getCandidates(provider: string, requiredCapabilities?: string[]): RegistryEntry[] {
    let candidates = this.registry.getOnline();

    // Filter by provider availability
    if (provider) {
      candidates = candidates.filter((e) => e.worker.providers.includes(provider));
    }

    // Filter by required capabilities
    if (requiredCapabilities && requiredCapabilities.length > 0) {
      candidates = candidates.filter((e) =>
        requiredCapabilities.every((c) => e.worker.capabilities.includes(c as any)),
      );
    }

    return candidates;
  }

  private toDecision(entry: RegistryEntry): ScheduleDecision {
    return {
      workerId: entry.worker.workerId,
      host: entry.worker.host,
      port: entry.worker.port,
    };
  }

  private leastLoaded(candidates: RegistryEntry[]): ScheduleDecision {
    const sorted = [...candidates].sort((a, b) => {
      const loadA = a.leases / Math.max(a.worker.capabilities.length, 1);
      const loadB = b.leases / Math.max(b.worker.capabilities.length, 1);
      return loadA - loadB || a.avgLatencyMs - b.avgLatencyMs;
    });
    return this.toDecision(sorted[0]);
  }

  private roundRobin(candidates: RegistryEntry[]): ScheduleDecision {
    const idx = this.roundRobinIndex % candidates.length;
    this.roundRobinIndex = (idx + 1) % candidates.length;
    return this.toDecision(candidates[idx]);
  }

  private benchmarkAware(candidates: RegistryEntry[]): ScheduleDecision {
    const sorted = [...candidates].sort((a, b) => {
      const scoreA = a.avgLatencyMs + a.failureRate * 1000;
      const scoreB = b.avgLatencyMs + b.failureRate * 1000;
      return scoreA - scoreB;
    });
    return this.toDecision(sorted[0]);
  }

  private capabilityAware(candidates: RegistryEntry[], requiredCapabilities?: string[]): ScheduleDecision {
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return this.leastLoaded(candidates);
    }
    const exact = candidates.filter((e) =>
      requiredCapabilities.every((c) => e.worker.capabilities.includes(c as any)),
    );
    if (exact.length > 0) return this.leastLoaded(exact);
    return this.leastLoaded(candidates);
  }
}
