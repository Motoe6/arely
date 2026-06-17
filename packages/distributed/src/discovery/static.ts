import type { DiscoveryProvider } from "./provider.js";
import type { WorkerInfo } from "../types.js";

export interface StaticDiscoveryConfig {
  workers: Array<{
    workerId: string;
    host: string;
    port: number;
    providers?: string[];
    models?: string[];
  }>;
}

export class StaticDiscovery implements DiscoveryProvider {
  readonly name = "static";
  private config: StaticDiscoveryConfig;
  private joinCb?: (worker: WorkerInfo) => void;
  private leaveCb?: (workerId: string) => void;
  private started = false;

  constructor(config: StaticDiscoveryConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const w of this.config.workers) {
      this.joinCb?.({
        workerId: w.workerId,
        host: w.host,
        port: w.port,
        version: "1.0.0",
        capabilities: ["llm"],
        providers: w.providers ?? ["openai"],
        models: w.models ?? ["gpt-4o"],
        startedAt: Date.now(),
      });
    }
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async refresh(): Promise<WorkerInfo[]> {
    return this.config.workers.map((w) => ({
      workerId: w.workerId,
      host: w.host,
      port: w.port,
      version: "1.0.0",
      capabilities: ["llm"],
      providers: w.providers ?? ["openai"],
      models: w.models ?? ["gpt-4o"],
      startedAt: Date.now(),
    }));
  }

  onJoin(cb: (worker: WorkerInfo) => void): void {
    this.joinCb = cb;
  }

  onLeave(cb: (workerId: string) => void): void {
    this.leaveCb = cb;
  }
}
