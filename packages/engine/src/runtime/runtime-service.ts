import { AutonomousRuntime } from "./runtime-loop.js";
import { DefaultGoalManager } from "./goal-manager.js";
import { DefaultReplanner } from "./replanner.js";
import { DefaultRecoveryManager } from "./recovery-manager.js";
import { DefaultPolicyEngine } from "./policy-engine.js";
import { metrics } from "../metrics.js";
import type {
  RuntimeStatus,
  RuntimeEvent,
  RuntimeServiceStatus,
  IRuntimeService,
  GoalManager,
} from "./runtime-types.js";

let instance: RuntimeService | null = null;

/**
 * RuntimeService — singleton façade for the autonomous runtime.
 *
 * Responsibilities:
 * - Singleton lifecycle (one runtime per process)
 * - State transitions (starting/stopping)
 * - Status snapshots
 * - Signal handling (SIGINT/SIGTERM)
 * - Metrics exposure
 */
export class RuntimeService implements IRuntimeService {
  private runtime: AutonomousRuntime;
  private created = Date.now();

  constructor() {
    const goalManager = new DefaultGoalManager();
    this.runtime = new AutonomousRuntime({
      goalManager,
      execute: async (_role, _systemPrompt, task, _context) => {
        // Default stub — real execution requires LLM wiring
        throw new Error(`No LLM executor configured. Goal: ${task}`);
      },
      replanner: new DefaultReplanner(goalManager),
      recoveryManager: new DefaultRecoveryManager(goalManager),
      policyEngine: new DefaultPolicyEngine(),
      loopIntervalMs: 5_000,
    });
  }

  static getInstance(): RuntimeService {
    if (!instance) {
      instance = new RuntimeService();
    }
    return instance;
  }

  static resetInstance(): void {
    if (instance) {
      instance.stop();
      instance = null;
    }
  }

  start(): void {
    if (this.runtime.getStatus() === "starting" || this.runtime.getStatus() === "running") return;
    this.runtime.start();
    metrics.setGauge("autonomous_runtime_state", {}, 1);
  }

  stop(): void {
    if (this.runtime.getStatus() === "stopped" || this.runtime.getStatus() === "stopping") return;
    this.runtime.stop();
    metrics.setGauge("autonomous_runtime_state", {}, 0);
  }

  pause(): void {
    if (this.runtime.getStatus() !== "running") return;
    this.runtime.pause();
    metrics.setGauge("autonomous_runtime_state", {}, 2);
  }

  resume(): void {
    if (this.runtime.getStatus() !== "paused") return;
    this.runtime.resume();
    metrics.setGauge("autonomous_runtime_state", {}, 1);
  }

  status(): RuntimeServiceStatus {
    const status = this.runtime.getStatus();
    const goals = this.runtime.getGoalManager();
    const all = goals.listGoals();
    const policyEng = this.runtime.getPolicyEngine();

    return {
      state: status,
      uptimeMs: this.runtime.getUptimeMs(),
      goals: {
        pending: all.filter((g) => g.status === "pending").length,
        running: all.filter((g) => g.status === "running").length,
        completed: all.filter((g) => g.status === "completed").length,
        failed: all.filter((g) => g.status === "failed").length,
        blocked: all.filter((g) => g.status === "blocked").length,
      },
      policies: policyEng.getAllPolicies(),
      iterationCount: this.runtime.getIterationCount(),
    };
  }

  getRuntime(): AutonomousRuntime {
    return this.runtime;
  }

  getGoalManager(): GoalManager {
    return this.runtime.getGoalManager();
  }

  on(event: string, listener: (event: RuntimeEvent) => void): void {
    this.runtime.on(event, listener);
  }

  off(event: string, listener: (event: RuntimeEvent) => void): void {
    this.runtime.off(event, listener);
  }

  /** Install SIGINT/SIGTERM handlers to stop gracefully. */
  installSignalHandlers(): void {
    const handleSignal = () => {
      if (this.runtime.getStatus() === "running" || this.runtime.getStatus() === "paused") {
        this.stop();
      }
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  }
}
