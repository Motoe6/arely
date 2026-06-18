/** Status of a runtime goal managed by the autonomous runtime. */
export type RuntimeGoalStatus =
  | "pending"
  | "running"
  | "blocked"
  | "completed"
  | "failed";

/** A goal tracked by the autonomous runtime loop. */
export interface RuntimeGoal {
  id: string;
  description: string;
  priority: number;
  status: RuntimeGoalStatus;
  parentGoalId?: string;
  dependencies: string[];
  retries: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastError?: string;
  tags: string[];
}

/** Runtime loop state. */
export type RuntimeStatus = "stopped" | "starting" | "running" | "paused" | "stopping";

/** Event emitted by the runtime loop. */
export interface RuntimeEvent {
  type: string;
  goalId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** Options for creating the autonomous runtime. */
export interface AutonomousRuntimeOptions {
  goalManager: GoalManager;
  execute: (role: string, systemPrompt: string, task: string, context: string, modelId?: string) => Promise<string>;
  hierarchicalExecutor?: {
    execute: (goal: string) => Promise<{ success: boolean; root: { status: string; error?: string }; errors: string[]; durationMs: number }>;
  };
  replanner?: Replanner;
  recoveryManager?: RecoveryManager;
  policyEngine?: PolicyEngine;
  loopIntervalMs?: number;
}

export interface GoalManager {
  createGoal(opts: {
    description: string;
    priority?: number;
    parentGoalId?: string;
    dependencies?: string[];
    maxRetries?: number;
    tags?: string[];
  }): RuntimeGoal;
  getGoal(id: string): RuntimeGoal | undefined;
  updateGoal(id: string, updates: Partial<RuntimeGoal>): void;
  listGoals(status?: RuntimeGoalStatus): RuntimeGoal[];
  getRunnableGoals(): RuntimeGoal[];
  blockGoal(id: string, reason: string): void;
  completeGoal(id: string): void;
  failGoal(id: string, error: string): void;
  getHistory(limit?: number): RuntimeGoal[];
  getActiveCount(): number;
}

export interface Replanner {
  replanSubtree(goal: RuntimeGoal, failedNodeId: string, error: string): Promise<RuntimeGoal[]>;
  replanGoal(goal: RuntimeGoal): Promise<RuntimeGoal>;
}

export interface RecoveryManager {
  recoverWorker(workerId: string): Promise<boolean>;
  recoverProvider(provider: string): Promise<boolean>;
  recoverCoordinator(): Promise<boolean>;
  recoverGoal(goal: RuntimeGoal): Promise<RuntimeGoal | null>;
}

export interface PolicyEngine {
  check(goal: RuntimeGoal): PolicyVerdict;
  getAllPolicies(): Policy[];
  updatePolicy(name: string, value: unknown): void;
  getPolicyValue?(name: string): unknown;
}

export interface Policy {
  name: string;
  value: unknown;
  description: string;
}

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; policy: string };

/** RuntimeService status snapshot. */
export interface RuntimeServiceStatus {
  state: RuntimeStatus;
  uptimeMs: number;
  goals: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
  };
  policies: Policy[];
  iterationCount: number;
}

/** RuntimeService exposes lifecycle + management of the autonomous runtime. */
export interface IRuntimeService {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  status(): RuntimeServiceStatus;
  getRuntime(): AutonomousRuntimeLike;
  getGoalManager(): GoalManager;
  on(event: string, listener: (event: RuntimeEvent) => void): void;
  off(event: string, listener: (event: RuntimeEvent) => void): void;
}

/** Minimal interface to avoid circular deps. */
export interface AutonomousRuntimeLike {
  getStatus(): RuntimeStatus;
  getGoalManager(): GoalManager;
  getPolicyEngine(): PolicyEngine;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  on(event: string, listener: (event: RuntimeEvent) => void): void;
  off(event: string, listener: (event: RuntimeEvent) => void): void;
}
