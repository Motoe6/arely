import type { RuntimeGoal, RecoveryManager, GoalManager } from "./runtime-types.js";

/**
 * RecoveryManager handles infrastructure-level failures.
 *
 * - Worker offline: attempt reconnection via heartbeat re-registration.
 * - Provider timeout: mark provider and fall back to alternatives.
 * - Goal-level: detect stuck goals and reset them.
 */
export class DefaultRecoveryManager implements RecoveryManager {
  private goalManager: GoalManager;

  constructor(goalManager: GoalManager) {
    this.goalManager = goalManager;
  }

  async recoverWorker(workerId: string): Promise<boolean> {
    // In a real distributed setup, this would ping the worker's
    // heartbeat endpoint. Here we simulate by checking if the
    // worker ID is valid and returning success.
    if (!workerId || workerId.length < 2) return false;
    return true;
  }

  async recoverProvider(provider: string): Promise<boolean> {
    // In production, this would test the provider endpoint.
    // For now, assume known providers are recoverable.
    const known = ["openai", "anthropic", "google", "ollama", "azure"];
    return known.includes(provider);
  }

  async recoverCoordinator(): Promise<boolean> {
    // Coordinator recovery would involve restarting the RPC server.
    return true;
  }

  async recoverGoal(goal: RuntimeGoal): Promise<RuntimeGoal | null> {
    if (goal.status !== "failed") return null;

    this.goalManager.updateGoal(goal.id, {
      status: "pending",
      retries: 0,
      lastError: undefined,
    });

    return this.goalManager.getGoal(goal.id) ?? null;
  }
}
