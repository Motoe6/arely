import type {
  RuntimeGoal,
  RuntimeStatus,
  RuntimeEvent,
  AutonomousRuntimeOptions,
  GoalManager,
  Replanner,
  RecoveryManager,
  PolicyEngine,
} from "./runtime-types.js";
import { DefaultGoalManager } from "./goal-manager.js";
import { DefaultReplanner } from "./replanner.js";
import { DefaultRecoveryManager } from "./recovery-manager.js";
import { DefaultPolicyEngine } from "./policy-engine.js";
import { metrics } from "../metrics.js";
import { tracer } from "../tracer.js";

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * AutonomousRuntime — the continuous execution loop for ARELY.
 *
 * ```
 * while (running) {
 *   goals = goalManager.getRunnableGoals()
 *   for (goal of goals):
 *     policyEngine.check(goal)
 *     hierarchicalExecutor.execute(goal)
 *     if failed:
 *       replanner.replanSubtree()
 *       recoveryManager.recoverGoal()
 *     goalManager.completeGoal() | failGoal()
 *   sleep(interval)
 * }
 * ```
 */
export class AutonomousRuntime {
  private status: RuntimeStatus = "stopped";
  private goalManager: GoalManager;
  private execute: AutonomousRuntimeOptions["execute"];
  private hierarchicalExecutor?: AutonomousRuntimeOptions["hierarchicalExecutor"];
  private replanner: Replanner;
  private recoveryManager: RecoveryManager;
  private policyEngine: PolicyEngine;
  private loopIntervalMs: number;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private eventListeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
  private iterationCount = 0;
  private startedAt: number = 0;

  constructor(opts: AutonomousRuntimeOptions) {
    this.goalManager = opts.goalManager;
    this.execute = opts.execute;
    this.hierarchicalExecutor = opts.hierarchicalExecutor;
    this.replanner = opts.replanner ?? new DefaultReplanner(opts.goalManager);
    this.recoveryManager = opts.recoveryManager ?? new DefaultRecoveryManager(opts.goalManager);
    this.policyEngine = opts.policyEngine ?? new DefaultPolicyEngine();
    this.loopIntervalMs = opts.loopIntervalMs ?? DEFAULT_INTERVAL_MS;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getGoalManager(): GoalManager {
    return this.goalManager;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  getUptimeMs(): number {
    if (this.status === "stopped" || this.startedAt === 0) return 0;
    return Date.now() - this.startedAt;
  }

  getIterationCount(): number {
    return this.iterationCount;
  }

  on(event: string, listener: (event: RuntimeEvent) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  off(event: string, listener: (event: RuntimeEvent) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try { listener(event); } catch { /* swallow listener errors */ }
      }
    }
  }

  start(): void {
    if (this.status === "running" || this.status === "starting") return;
    this.status = "starting";
    this.emit({ type: "runtime.starting", timestamp: Date.now() });
    this.status = "running";
    this.startedAt = Date.now();
    this.emit({ type: "runtime.started", timestamp: Date.now() });
    this.loop();
  }

  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    this.emit({ type: "runtime.paused", timestamp: Date.now() });
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.emit({ type: "runtime.resumed", timestamp: Date.now() });
    this.loop();
  }

  stop(): void {
    if (this.status === "stopped" || this.status === "stopping") return;
    this.status = "stopping";
    this.emit({ type: "runtime.stopping", timestamp: Date.now() });
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.status = "stopped";
    this.emit({ type: "runtime.stopped", timestamp: Date.now() });
  }

  private loop(): void {
    const tick = async (): Promise<void> => {
      if (this.status !== "running") return;

      const span = tracer.startSpan(
        `runtime-iteration-${this.iterationCount}`,
        "runtime.loop",
      );

      try {
        await this.runIteration();
        metrics.increment("autonomous_runtime_iterations_total", { status: "completed" });
      } catch (err) {
        metrics.increment("autonomous_runtime_iterations_total", { status: "failed" });
        this.emit({
          type: "runtime.iteration_error",
          timestamp: Date.now(),
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      }

      tracer.endSpan(span, {
        "runtime.iteration": String(this.iterationCount),
        "runtime.status": this.status,
      });

      this.iterationCount++;

      if (this.status === "running") {
        this.loopTimer = setTimeout(tick, this.loopIntervalMs);
      }
    };

    this.loopTimer = setTimeout(tick, 0);
  }

  private async runIteration(): Promise<void> {
    // Phase 1: Recovery check
    this.emit({ type: "runtime.recovery_check", timestamp: Date.now() });

    // Phase 2: Get runnable goals
    const runnable = this.goalManager.getRunnableGoals();
    metrics.setGauge("autonomous_goals_running", {}, runnable.length);

    for (const goal of runnable) {
      this.emit({ type: "goal.started", goalId: goal.id, timestamp: Date.now(), data: { description: goal.description } });
      metrics.increment("autonomous_goals_total", { goalId: goal.id });

      // Phase 3: Policy check
      const verdict = this.policyEngine.check(goal);
      if (!verdict.allowed) {
        this.goalManager.blockGoal(goal.id, verdict.reason);
        this.emit({ type: "goal.blocked", goalId: goal.id, timestamp: Date.now(), data: { reason: verdict.reason } });
        continue;
      }

      this.goalManager.updateGoal(goal.id, { status: "running" });

      // Phase 4: Execute
      const goalSpan = tracer.startSpan(`goal-${goal.id}`, "runtime.goal.execute");

      try {
        let success: boolean;
        let errors: string[] = [];

        if (this.hierarchicalExecutor) {
          const result = await this.hierarchicalExecutor.execute(goal.description);
          success = result.success;
          errors = result.errors;
        } else {
          // Fallback: flat execution via single LLM call
          try {
            await this.execute(
              "planner",
              "You are an autonomous agent. Complete the following goal.",
              goal.description,
              "",
            );
            success = true;
          } catch (err) {
            success = false;
            errors = [err instanceof Error ? err.message : String(err)];
          }
        }

        tracer.endSpan(goalSpan, {
          "runtime.goal_id": goal.id,
          "runtime.success": String(success),
        });

        if (success) {
          this.goalManager.completeGoal(goal.id);
          metrics.increment("autonomous_goals_completed_total", { goalId: goal.id });
          this.emit({ type: "goal.completed", goalId: goal.id, timestamp: Date.now() });
        } else {
          // Phase 5: Recovery + Replan
          this.goalManager.failGoal(goal.id, errors.join("; "));
          metrics.increment("autonomous_goals_failed_total", { goalId: goal.id });

          if (this.policyEngine.getPolicyValue?.("autoReplan") ?? true) {
            const newGoals = await this.replanner.replanSubtree(goal, "root", errors.join("; "));
            for (const ng of newGoals) {
              this.emit({ type: "goal.replanned", goalId: ng.id, timestamp: Date.now(), data: { parentGoalId: goal.id } });
            }
            metrics.increment("autonomous_replans_total", { goalId: goal.id });
          }

          this.emit({ type: "goal.failed", goalId: goal.id, timestamp: Date.now(), data: { errors } });
        }
      } catch (err) {
        tracer.endSpan(goalSpan, {
          "runtime.goal_id": goal.id,
          "runtime.success": "false",
          "runtime.error": err instanceof Error ? err.message : String(err),
        });
        this.goalManager.failGoal(goal.id, err instanceof Error ? err.message : String(err));
        metrics.increment("autonomous_goals_failed_total", { goalId: goal.id });
      }
    }
  }
}
