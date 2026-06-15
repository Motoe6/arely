// ── Tool Lifecycle ──

export interface BeforeToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
}

export interface AfterToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  sessionId: string;
}

// ── Memory Lifecycle ──

export interface BeforeMemoryStoreContext {
  key: string;
  value: string;
  type: string;
}

export interface AfterMemoryStoreContext {
  key: string;
  value: string;
  type: string;
  success: boolean;
}

// ── Decision Lifecycle ──

export interface BeforeDecisionContext {
  decisionType: string;
  context: Record<string, unknown>;
}

export interface AfterDecisionContext {
  decisionType: string;
  outcome: string;
  decision: unknown;
}

// ── Strategy Lifecycle ──

export interface BeforeStrategySelectionContext {
  goal: string;
  availableActions: string[];
}

export interface AfterStrategySelectionContext {
  goal: string;
  selectedAction: string;
  reasoning: string;
}

// ── Prediction Lifecycle ──

export interface BeforePredictionContext {
  decisionType: string;
  context: Record<string, unknown>;
}

export interface AfterPredictionContext {
  decisionType: string;
  prediction: { successProbability: number; confidence: number };
}

// ── Vault Lifecycle (from n8n credential hooks) ──

export interface BeforeVaultAccessContext {
  action: "read" | "write" | "delete";
  secretId: string;
}

export interface AfterVaultAccessContext {
  action: "read" | "write" | "delete";
  secretId: string;
  success: boolean;
}

// ── Execution Lifecycle (from n8n ExecutionLifecycleHooks) ──

export interface BeforeExecutionContext {
  nodeId: string;
  nodeType: string;
  inputs: Record<string, unknown>;
}

export interface AfterExecutionContext {
  nodeId: string;
  nodeType: string;
  output: unknown;
  durationMs: number;
  error?: string;
}

// ── Agent Lifecycle (from AutoGPT component pipeline) ──

export interface BeforeAgentCycleContext {
  cycle: number;
  maxCycles: number;
}

export interface AfterAgentCycleContext {
  cycle: number;
  actionsTaken: number;
}

// ── Component Lifecycle (n8n module lifecycle) ──

export interface ComponentLifecycleContext {
  componentId: string;
  phase: "initialize" | "cleanup";
}

// ── Full Hooks Interface ──

export interface ArelyPluginHooks {
  // Tool hooks
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<{ block?: boolean; reason?: string } | void>;
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<void>;

  // Memory hooks
  beforeMemoryStore?: (ctx: BeforeMemoryStoreContext) => Promise<void>;
  afterMemoryStore?: (ctx: AfterMemoryStoreContext) => Promise<void>;

  // Decision hooks
  beforeDecision?: (ctx: BeforeDecisionContext) => Promise<void>;
  afterDecision?: (ctx: AfterDecisionContext) => Promise<void>;

  // Strategy hooks
  beforeStrategySelection?: (ctx: BeforeStrategySelectionContext) => Promise<void>;
  afterStrategySelection?: (ctx: AfterStrategySelectionContext) => Promise<void>;

  // Prediction hooks
  beforePrediction?: (ctx: BeforePredictionContext) => Promise<void>;
  afterPrediction?: (ctx: AfterPredictionContext) => Promise<void>;

  // Vault hooks (from n8n)
  beforeVaultAccess?: (ctx: BeforeVaultAccessContext) => Promise<{ block?: boolean; reason?: string } | void>;
  afterVaultAccess?: (ctx: AfterVaultAccessContext) => Promise<void>;

  // Execution hooks (from n8n ExecutionLifecycleHooks)
  beforeExecution?: (ctx: BeforeExecutionContext) => Promise<void>;
  afterExecution?: (ctx: AfterExecutionContext) => Promise<void>;

  // Agent lifecycle hooks (from AutoGPT component pipeline)
  beforeAgentCycle?: (ctx: BeforeAgentCycleContext) => Promise<void>;
  afterAgentCycle?: (ctx: AfterAgentCycleContext) => Promise<void>;

  // Component lifecycle
  onComponentInit?: (ctx: ComponentLifecycleContext) => Promise<void>;
  onComponentCleanup?: (ctx: ComponentLifecycleContext) => Promise<void>;
}

export type HookName = keyof ArelyPluginHooks;

type AnyHookFn = (...args: unknown[]) => Promise<unknown>;

export function mergeHooks(hooks: ArelyPluginHooks[]): ArelyPluginHooks {
  const merged: ArelyPluginHooks = {};

  for (const hook of hooks) {
    for (const key of Object.keys(hook) as HookName[]) {
      const fn = hook[key];
      if (!fn) continue;

      const existing = merged[key] as AnyHookFn | undefined;
      const current = fn as AnyHookFn;

      if (existing) {
        (merged as Record<string, unknown>)[key] = (async (ctx: unknown) => {
          await existing(ctx);
          await current(ctx);
        }) as AnyHookFn;
      } else {
        (merged as Record<string, unknown>)[key] = current;
      }
    }
  }

  return merged;
}
