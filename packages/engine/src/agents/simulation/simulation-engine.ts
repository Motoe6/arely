import { createHash } from "node:crypto";
import { PolicyEngine } from "../policy/policy-engine.js";
import type { PolicyRule, PolicyEvaluationInput, CircuitBreakerMap } from "../policy/policy-types.js";
import type { PolicyAuditEvent } from "../../persistence/policy-audit-store.js";

export type SimulationError = "trace_not_found" | "missing_cycle_started" | "invalid_audit_payload";

export interface SimAction {
  ruleId: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface SimulationResult {
  traceId: string;
  error?: SimulationError;
  policyHash?: string;
  simulatedPolicyHash: string;
  originalActions: SimAction[];
  simulatedActions: SimAction[];
  added: SimAction[];
  removed: SimAction[];
  matchRate: number;
}

export interface BatchSimulationResult {
  tracesRequested: number;
  tracesSucceeded: number;
  tracesFailed: number;
  totalAdded: number;
  totalRemoved: number;
  overallMatchRate: number;
  results: SimulationResult[];
}

export interface AuditStorePort {
  getTrace(traceId: string): PolicyAuditEvent[];
}

export function computePolicyHash(rules: PolicyRule[]): string {
  const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

export class SimulationEngine {
  constructor(private auditStore: AuditStorePort) {}

  simulateTrace(traceId: string, rules: PolicyRule[]): SimulationResult {
    const simulatedPolicyHash = computePolicyHash(rules);
    const events = this.auditStore.getTrace(traceId);
    if (events.length === 0) {
      return {
        traceId,
        error: "trace_not_found",
        simulatedPolicyHash,
        originalActions: [],
        simulatedActions: [],
        added: [],
        removed: [],
        matchRate: 1.0,
      };
    }

    const cycleStarted = events.find((e) => e.eventType === "cycle_started");
    if (!cycleStarted) {
      return {
        traceId,
        error: "missing_cycle_started",
        simulatedPolicyHash,
        originalActions: [],
        simulatedActions: [],
        added: [],
        removed: [],
        matchRate: 1.0,
      };
    }

    const payload = cycleStarted.payload;
    if (typeof payload !== "object") {
      return {
        traceId,
        error: "invalid_audit_payload",
        simulatedPolicyHash,
        originalActions: [],
        simulatedActions: [],
        added: [],
        removed: [],
        matchRate: 1.0,
      };
    }

    const input: PolicyEvaluationInput = {
      metrics: payload.metrics as PolicyEvaluationInput["metrics"],
      circuitBreakerStates: payload.circuitBreakerStates as CircuitBreakerMap,
    };

    const engine = new PolicyEngine(rules);
    const results = engine.evaluate(input);

    const simulatedActions: SimAction[] = results
      .filter((r) => r.matched)
      .map((r) => ({
        ruleId: r.ruleId,
        action: r.action!.action,
        payload: r.action!.payload,
      }));

    const originalActions = (payload.actions ?? []) as SimAction[];

    const originalIds = new Set(originalActions.map((a) => a.ruleId));
    const simulatedIds = new Set(simulatedActions.map((a) => a.ruleId));

    const added = simulatedActions.filter((a) => !originalIds.has(a.ruleId));
    const removed = originalActions.filter((a) => !simulatedIds.has(a.ruleId));

    const matchRate = computeMatchRate(originalActions, simulatedActions);

    return {
      traceId,
      policyHash: payload.policyHash as string | undefined,
      simulatedPolicyHash,
      originalActions,
      simulatedActions,
      added,
      removed,
      matchRate,
    };
  }

  simulateBatch(traceIds: string[], rules: PolicyRule[]): BatchSimulationResult {
    const results = traceIds.map((traceId) => this.simulateTrace(traceId, rules));

    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    const totalAdded = succeeded.reduce((sum, r) => sum + r.added.length, 0);
    const totalRemoved = succeeded.reduce((sum, r) => sum + r.removed.length, 0);
    const overallMatchRate =
      succeeded.length > 0
        ? succeeded.reduce((sum, r) => sum + r.matchRate, 0) / succeeded.length
        : 1.0;

    return {
      tracesRequested: traceIds.length,
      tracesSucceeded: succeeded.length,
      tracesFailed: failed.length,
      totalAdded,
      totalRemoved,
      overallMatchRate,
      results,
    };
  }
}

function computeMatchRate(original: SimAction[], simulated: SimAction[]): number {
  if (original.length === 0 && simulated.length === 0) return 1.0;
  const max = Math.max(original.length, simulated.length);
  const added = simulated.filter((a) => !original.some((o) => o.ruleId === a.ruleId));
  const removed = original.filter((o) => !simulated.some((a) => a.ruleId === o.ruleId));
  return 1 - (added.length + removed.length) / max;
}
