import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { pushSchema } from "@opencode/engine/persistence/migrate.js";
import { connect, close } from "@opencode/engine/persistence/database.js";
import { getTrace, listTraces, countTraces } from "@opencode/engine/persistence/policy-audit-store.js";
import { SimulationEngine } from "@opencode/engine/agents/simulation/simulation-engine.js";
import { FileSystemPolicyPackStore } from "@opencode/engine/agents/policy/policy-pack.js";
import { PolicyRecommender, type RecommenderAuditPort } from "@opencode/engine/agents/policy/policy-recommender.js";
import { ImpactAnalyzer } from "@opencode/engine/agents/policy/impact-analyzer.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";

function makeRule(id: string, overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id, when: {},
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000, maxExecutionsPerHour: 10,
    ...overrides,
  };
}

function makeMetricValue(traceIdx: number, total: number): number {
  const frac = traceIdx / total;
  if (frac < 0.2) return 0.1 + Math.random() * 0.1;
  if (frac < 0.4) return 0.3 + Math.random() * 0.1;
  if (frac < 0.6) return 0.5 + Math.random() * 0.1;
  if (frac < 0.8) return 0.7 + Math.random() * 0.1;
  return 0.9 + Math.random() * 0.099;
}

function seedTraces(db: Database.Database, n: number): void {
  const insert = db.prepare(
    "INSERT INTO policy_audit_events (id, trace_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const traceId = `bt-${String(i).padStart(6, "0")}`;
      const successRate = makeMetricValue(i, n);
      const retryRate = Math.max(0, 1 - successRate - 0.05 + Math.random() * 0.1);
      const deadLetterRate = Math.random() * 0.05;
      const notifDeliveryRate = 0.85 + Math.random() * 0.15;

      const actions: Array<{ ruleId: string; action: string; payload: Record<string, unknown> }> = [];
      if (successRate < 0.5) actions.push({ ruleId: "rule_low_success", action: "trigger_remediation", payload: {} });
      if (retryRate > 0.3) actions.push({ ruleId: "rule_high_retry", action: "trigger_remediation", payload: {} });
      if (deadLetterRate > 0.02) actions.push({ ruleId: "rule_dead_letter", action: "trigger_remediation", payload: {} });
      if (notifDeliveryRate < 0.9) actions.push({ ruleId: "rule_low_delivery", action: "escalate_alert", payload: {} });

      insert.run(ulid(), traceId, "cycle_started", JSON.stringify({
        metrics: { successRate, retryRate, deadLetterRate, notificationDeliveryRate: notifDeliveryRate },
        circuitBreakerStates: { "svc-a": i % 3 === 0 ? "open" : "closed", "svc-b": "closed" },
        actions,
      }), new Date().toISOString());
    }
  });
  tx();
}

const PACK_RULES: PolicyRule[] = [
  makeRule("rule_low_success", { when: { successRate: { lt: 0.5 } } }),
  makeRule("rule_high_retry", { when: { retryRate: { gt: 0.3 } } }),
  makeRule("rule_dead_letter", { when: { deadLetterRate: { gt: 0.02 } } }),
  makeRule("rule_low_delivery", { when: { notificationDeliveryRate: { lt: 0.9 } } }),
  makeRule("rule_never_hits", { when: { successRate: { lt: 0.0 } } }),
];

interface BenchResult { mean: number; median: number; min: number; max: number; }

function bench(fn: () => void, runs: number): BenchResult {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    mean: samples.reduce((s, v) => s + v, 0) / samples.length,
    median: sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function fmt(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

function setupScale(n: number, tmpDir: string): { traceIds: string[]; engine: SimulationEngine; analyzer: ImpactAnalyzer; deadRec: import("@opencode/engine/agents/policy/policy-recommender.js").PolicyRecommendation | undefined; recs: import("@opencode/engine/agents/policy/policy-recommender.js").PolicyRecommendation[] } {
  const dbPath = join(tmpDir, "bench.db");
  pushSchema(dbPath);
  connect(dbPath);

  const seedDb = new Database(dbPath);
  seedDb.pragma("foreign_keys = ON");
  seedTraces(seedDb, n);
  seedDb.close();

  const packStore = new FileSystemPolicyPackStore(tmpDir);
  const engine = new SimulationEngine({ getTrace });
  const pack = packStore.create({ name: "bench-pack", description: "benchmark", rules: PACK_RULES });

  const auditPort: RecommenderAuditPort = {
    listTraces: (l, o) => listTraces(l, o),
    countTraces: () => countTraces(),
    getTrace: (tid) => getTrace(tid),
  };
  const recommender = new PolicyRecommender(packStore, auditPort, { maxTraces: n });
  const analyzer = new ImpactAnalyzer(packStore, engine, { listTraces }, { maxTraces: n });

  const recs = recommender.analyzePack(pack.id);
  const deadRec = recs.find((r) => r.type === "dead_rule");
  const traceIds = listTraces(n, 0).map((s) => s.traceId);

  return { traceIds, engine, analyzer, deadRec, recs };
}

const SCALES = [100, 500, 1000];
const RUNS = 5;
const tmpBase = join(tmpdir(), "policy-benchmark");

async function main(): Promise<void> {
  console.log("=".repeat(76));
  console.log("  A2: F32/F35 Benchmark — SimulationEngine + ImpactAnalyzer");
  console.log(`  Runs per scale: ${RUNS}  |  Config: 5 rules, ${SCALES.join("/")} traces`);
  console.log("=".repeat(76));

  // ---- Warmup ----
  console.log("\n  Warming up...");
  const warmDir = join(tmpBase, "warmup");
  mkdirSync(warmDir, { recursive: true });
  const warm = setupScale(50, warmDir);
  for (let i = 0; i < 3; i++) {
    warm.engine.simulateBatch(warm.traceIds, PACK_RULES);
    if (warm.deadRec) warm.analyzer.validate(warm.deadRec);
  }
  close();
  rmSync(warmDir, { recursive: true, force: true });
  console.log("  Warmup done.");

  const allResults: Array<{ scale: number; simMs: number; impactMs: number; allMs: number }> = [];

  for (const n of SCALES) {
    const scaleDir = join(tmpBase, `scale-${n}`);
    mkdirSync(scaleDir, { recursive: true });

    const { traceIds, engine, analyzer, deadRec, recs } = setupScale(n, scaleDir);

    console.log(`\n${"▔".repeat(76)}`);
    console.log(`  Scale: ${n} traces  (${traceIds.length} IDs loaded, ${countTraces()} in DB)`);
    console.log(`  Recommendations: ${recs.length} (dead_rule: ${!!deadRec})`);

    // F32
    const simR = bench(() => { engine.simulateBatch(traceIds, PACK_RULES); }, RUNS);
    console.log(`\n  F32 simulateBatch:`);
    console.log(`    mean ${fmt(simR.mean)}  median ${fmt(simR.median)}  min ${fmt(simR.min)}  max ${fmt(simR.max)}`);

    const verifySim = engine.simulateBatch(traceIds, PACK_RULES);
    console.log(`    verify: ${verifySim.tracesSucceeded}/${verifySim.tracesRequested} OK, match=${(verifySim.overallMatchRate * 100).toFixed(1)}%`);

    // F35 validate (pass explicit traceIds for fair comparison)
    let impactR: BenchResult = { mean: 0, median: 0, min: 0, max: 0 };
    if (deadRec) {
      impactR = bench(() => { analyzer.validate(deadRec, traceIds); }, RUNS);
      console.log(`  F35 validate (dead_rule):`);
      console.log(`    mean ${fmt(impactR.mean)}  median ${fmt(impactR.median)}  min ${fmt(impactR.min)}  max ${fmt(impactR.max)}`);

      const verify = analyzer.validate(deadRec, traceIds);
      console.log(`    verify: confidence=${verify.confidence} score=${verify.impactScore.toFixed(3)} matchDelta=${verify.matchRateDelta.toFixed(4)}`);
    }

    // F35 validateAll
    let allR: BenchResult = { mean: 0, median: 0, min: 0, max: 0 };
    if (recs.length > 0) {
      allR = bench(() => {
        for (const rec of recs) analyzer.validate(rec, traceIds);
      }, RUNS);
      console.log(`  F35 validateAll (${recs.length} recs, sequential):`);
      console.log(`    mean ${fmt(allR.mean)}  median ${fmt(allR.median)}  min ${fmt(allR.min)}  max ${fmt(allR.max)}`);
      console.log(`    per-recommendation: ${fmt(allR.mean / recs.length)}`);
    }

    allResults.push({ scale: n, simMs: simR.mean, impactMs: impactR.mean, allMs: allR.mean });

    close();
    rmSync(scaleDir, { recursive: true, force: true });
  }

  // Summary table
  console.log("\n" + "=".repeat(76));
  console.log("  SUMMARY");
  console.log("=".repeat(76));
  const hdr = (s: string) => s.padEnd(14);
  console.log(`  ${hdr("Traces")} ${hdr("F32 mean")} ${hdr("F35 mean")} ${hdr("F32/trace")} ${hdr("F35/trace")}`);
  console.log(`  ${hdr("------")} ${hdr("--------")} ${hdr("--------")} ${hdr("---------")} ${hdr("---------")}`);
  for (const r of allResults) {
    const perSim = r.simMs / r.scale;
    const perImpact = r.scale > 0 && r.impactMs > 0 ? r.impactMs / r.scale : 0;
    console.log(`  ${hdr(String(r.scale))} ${hdr(fmt(r.simMs))} ${hdr(fmt(r.impactMs))} ${hdr(fmt(perSim))} ${hdr(perImpact > 0 ? fmt(perImpact) : "N/A")}`);
  }

  const simNs = allResults.filter(r => r.simMs > 0);
  if (simNs.length >= 2) {
    const growth = simNs.map((r, i) => i > 0 ? r.simMs / simNs[i - 1].simMs : 0).filter(g => g > 0);
    const avgGrowth = growth.reduce((s, v) => s + v, 0) / growth.length;
    const nearestPower = simNs.map((r, i) => i > 0 ? r.scale / simNs[i - 1].scale : 0).filter(g => g > 0);
    const avgScale = nearestPower.reduce((s, v) => s + v, 0) / nearestPower.length;
    console.log(`\n  F32 growth factor: ~${avgGrowth.toFixed(2)}× per ~${avgScale.toFixed(1)}× trace increase (near-${avgGrowth / avgScale < 1.1 ? "linear" : "super-linear"} scaling)`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
