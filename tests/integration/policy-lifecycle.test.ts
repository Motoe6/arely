import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { insertEvent, getTrace, listTraces, countTraces } from "@opencode/engine/persistence/policy-audit-store.js";
import { SimulationEngine } from "@opencode/engine/agents/simulation/simulation-engine.js";
import { FileSystemPolicyPackStore } from "@opencode/engine/agents/policy/policy-pack.js";
import { PolicyRecommender, type RecommenderAuditPort } from "@opencode/engine/agents/policy/policy-recommender.js";
import { ImpactAnalyzer } from "@opencode/engine/agents/policy/impact-analyzer.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";

const tmpDir = join(tmpdir(), "policy-lifecycle-test");

function makeRule(id: string, when: Partial<PolicyRule["when"]> = {}): PolicyRule {
  return { id, when, then: { type: "trigger_remediation", payload: {} }, cooldownMs: 60000, maxExecutionsPerHour: 10 };
}

describe("F31→F34→F35 integration", () => {
  let packStore: FileSystemPolicyPackStore;
  let engine: SimulationEngine;
  let recommender: PolicyRecommender;
  let analyzer: ImpactAnalyzer;
  let traceIds: string[];

  beforeAll(() => {
    initTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    packStore = new FileSystemPolicyPackStore(tmpDir);
    engine = new SimulationEngine({ getTrace });

    const auditPort: RecommenderAuditPort = {
      listTraces: (limit, offset) => listTraces(limit, offset),
      countTraces: () => countTraces(),
      getTrace: (traceId) => getTrace(traceId),
    };
    recommender = new PolicyRecommender(packStore, auditPort);
    analyzer = new ImpactAnalyzer(packStore, engine, { listTraces });
  });

  afterAll(() => {
    cleanupTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full lifecycle: audit → simulate → recommend → validate", () => {
    // --- F31: seed audit traces ---
    insertEvent("trace-a", "cycle_started", {
      metrics: { successRate: 0.85, retryRate: 0.05 },
      circuitBreakerStates: {},
      actions: [{ ruleId: "high_success", action: "trigger_remediation", payload: {} }],
    });
    insertEvent("trace-b", "cycle_started", {
      metrics: { successRate: 0.95, retryRate: 0.02 },
      circuitBreakerStates: {},
      actions: [],
    });
    insertEvent("trace-c", "cycle_started", {
      metrics: { successRate: 0.78, retryRate: 0.12 },
      circuitBreakerStates: {},
      actions: [{ ruleId: "high_success", action: "trigger_remediation", payload: {} }],
    });

    traceIds = listTraces().map((s) => s.traceId);
    expect(traceIds).toHaveLength(3);

    // --- F33: create pack ---
    const rules: PolicyRule[] = [
      makeRule("high_success", { successRate: { lt: 0.9 } }),
      makeRule("never_hit", { successRate: { lt: 0 } }),
    ];
    const pack = packStore.create({ name: "lifecycle-pack", description: "integration test", rules });
    expect(pack.id).toBeTruthy();
    expect(pack.rules).toHaveLength(2);

    // --- F32: simulate ---
    const simResult = engine.simulateBatch(traceIds, rules);
    expect(simResult.tracesRequested).toBe(3);
    expect(simResult.tracesSucceeded).toBe(3);
    expect(simResult.tracesFailed).toBe(0);

    // --- F34: recommendations ---
    const recs = recommender.analyzePack(pack.id);
    const deadRec = recs.find((r) => r.type === "dead_rule");
    expect(deadRec).toBeDefined();
    expect(deadRec!.ruleId).toBe("never_hit");

    // --- F35: validate recommendation ---
    const impact = analyzer.validate(deadRec!);
    expect(impact.impactScore).toBe(0);
    expect(impact.tracesRequested).toBe(3);
    expect(impact.tracesSucceeded).toBe(3);
    expect(impact.originalTotalActions).toBe(impact.simulatedTotalActions);
    expect(impact.removedRules).toHaveLength(0);
  });

  it("returns trace_not_found for missing trace", () => {
    const rules = [makeRule("r1")];
    const result = engine.simulateTrace("nonexistent-trace", rules);
    expect(result.error).toBe("trace_not_found");
  });

  it("handles empty pack without throwing", () => {
    const emptyPack = packStore.create({ name: "empty-pack", description: "", rules: [] });
    const recs = recommender.analyzePack(emptyPack.id);
    expect(recs).toHaveLength(0);

    const simResult = engine.simulateBatch(traceIds, []);
    expect(simResult.tracesSucceeded).toBe(3);
    expect(simResult.overallMatchRate).toBeLessThan(1);
    expect(simResult.totalRemoved).toBeGreaterThanOrEqual(1);
  });

  it("handles stale recommendation (rule removed from pack)", () => {
    const pack = packStore.create({
      name: "stale-pack",
      description: "",
      rules: [makeRule("active_rule")],
    });
    const rec = {
      type: "dead_rule" as const,
      severity: "medium" as const,
      packId: pack.id,
      ruleId: "removed_rule",
      title: "test",
      description: "test",
      evidence: {},
      suggestedAction: "test",
    };
    const report = analyzer.validate(rec);
    expect(report.tracesRequested).toBe(3);
    // Simulating with the pack's rules won't include "removed_rule",
    // so original == simulated for any rule set, giving impactScore 0
    expect(report.impactScore).toBe(0);
  });

  it("processes multiple recommendations via validateAll", () => {
    const rules: PolicyRule[] = [
      makeRule("r1", { successRate: { lt: 0.9 } }),
      makeRule("r2", { successRate: { lt: 0 } }),
      makeRule("r3", { retryRate: { gt: 0.5 } }),
    ];
    const pack = packStore.create({ name: "multi-pack", description: "", rules });
    const recs = recommender.analyzePack(pack.id);
    expect(recs.length).toBeGreaterThanOrEqual(1);

    const reports = analyzer.validateAll(recs);
    expect(reports).toHaveLength(recs.length);
    for (const report of reports) {
      expect(report.tracesRequested).toBeGreaterThan(0);
      expect(report.impactScore).toBeGreaterThanOrEqual(0);
      expect(report.impactScore).toBeLessThanOrEqual(1);
    }
  });
});
