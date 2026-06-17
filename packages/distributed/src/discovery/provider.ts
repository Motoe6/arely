import type { WorkerInfo } from "../types.js";

export interface DiscoveryProvider {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<WorkerInfo[]>;
  onJoin(cb: (worker: WorkerInfo) => void): void;
  onLeave(cb: (workerId: string) => void): void;
}
