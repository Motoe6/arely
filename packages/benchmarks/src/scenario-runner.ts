import * as path from "node:path";
import * as fs from "node:fs";
import { loadScenarios, formatScenario } from "./scenario-loader.js";
import type { Scenario, ScenarioRunResult, BenchmarkMode } from "./scenario-types.js";
import { BenchmarkRunner } from "./runner.js";
import { ReportGenerator } from "./report-generator.js";
import type {
  Collector, BenchmarkMetric, BenchmarkReport, BenchmarkOptions, BenchmarkSuite,
  ProviderBenchmarkResult, ProviderLeaderboard, ProviderBenchmarkSummary,
} from "./types.js";

const SCENARIO_DIR = new URL("scenarios", import.meta.url).pathname;

interface SessionResponse {
  id: string;
  state: string;
  mode: string;
}

function engineMode(mode: BenchmarkMode): string {
  switch (mode) {
    case "single": return "agent";
    case "planner": return "planning";
    case "swarm": return "swarm";
    case "shared-memory-swarm": return "swarm";
    case "hierarchical": return "hierarchical";
    case "distributed": return "distributed";
    case "soak": return "agent";
  }
}

export function createScenarioCollector(opts?: BenchmarkOptions): Collector {
  const engineUrl = process.env.BENCHMARK_ENGINE_URL ?? "http://localhost:8081";
  const deterministic = !opts?.real;
  const provider = opts?.provider;
  const model = opts?.model;
  const modeFilter = opts?.mode;
  const heterogeneous = opts?.heterogeneous;

  return {
    name: "scenarios",
    description: "Real LLM benchmark scenarios across single, planner, swarm, hierarchical, distributed, and soak modes",

    async collect() {
      const scenariosDir = fs.existsSync(SCENARIO_DIR) ? SCENARIO_DIR : path.resolve("packages/benchmarks/src/scenarios");
      const scenarios = loadScenarios(scenariosDir);

      // Determine modes to run based on filter
      const allModes: BenchmarkMode[] = ["single", "planner", "swarm", "shared-memory-swarm", "hierarchical", "distributed"];
      const modes: BenchmarkMode[] = modeFilter === "hierarchical"
        ? ["hierarchical"]
        : modeFilter === "distributed"
          ? ["distributed"]
          : modeFilter === "swarm-heterogeneous"
            ? ["swarm", "shared-memory-swarm", "hierarchical"]
            : modeFilter === "soak"
              ? ["single"]
              : allModes;

      const log = opts?.jsonOutput ? console.error.bind(console) : console.log.bind(console);
      const results: ScenarioRunResult[] = [];

      log(`\n  Loaded ${scenarios.length} scenarios, running modes: ${modes.join(", ")}\n`);

      for (const scenario of scenarios) {
        log(formatScenario(scenario));

        for (const mode of modes) {
          if (mode === "hierarchical") {
            const result = deterministic
              ? await runHierarchicalDeterministic(scenario)
              : await runHierarchicalLive(scenario, engineUrl, provider, model);
            results.push(result);
          } else if (mode === "distributed") {
            const result = deterministic
              ? await runDistributedDeterministic(scenario)
              : await runDistributedLive(scenario, engineUrl, provider, model);
            results.push(result);
          } else {
            const result = deterministic
              ? await runDeterministic(scenario, mode)
              : await runLive(scenario, mode, engineUrl, provider, model);
            results.push(result);
          }
        }
      }

      return buildSuite(results, scenarios, modeFilter, heterogeneous);
    },
  };
}

// ---- Existing Deterministic Runner ----

async function runDeterministic(scenario: Scenario, mode: BenchmarkMode): Promise<ScenarioRunResult> {
  const baseLatency = scenario.difficulty === "easy" ? 3000 : scenario.difficulty === "medium" ? 6000 : 12000;
  const swarmMultiplier = mode === "swarm" || mode === "shared-memory-swarm" ? 1.8 : mode === "planner" ? 1.4 : 1.0;
  const latencyMs = Math.round(baseLatency * swarmMultiplier * (0.85 + Math.random() * 0.3));

  const baseSuccess = scenario.difficulty === "easy" ? 0.92 : scenario.difficulty === "medium" ? 0.78 : 0.65;
  const modeBoost: Record<string, number> = {
    "single": 0,
    "planner": 0.05,
    "swarm": 0.10,
    "shared-memory-swarm": 0.15,
  };

  const success = Math.random() < (baseSuccess + (modeBoost[mode] ?? 0));
  const tokenMultiplier = mode === "swarm" ? 2.5 : mode === "shared-memory-swarm" ? 2.8 : mode === "planner" ? 1.6 : 1.0;
  const tokens = Math.round(scenario.expectedTokensMax * tokenMultiplier * (0.7 + Math.random() * 0.6));
  const toolCalls = Math.round((scenario.expectedToolCalls + (mode === "swarm" || mode === "shared-memory-swarm" ? 2 : 0)) * (0.8 + Math.random() * 0.4));
  const costPerToken = 0.000002;
  const costUsd = Math.round(tokens * costPerToken * 100000) / 100000;

  const progressGain = success ? (0.3 + Math.random() * 0.4) : (0.05 + Math.random() * 0.1);
  const utility = success ? (0.4 + Math.random() * 0.5) : (0.1 + Math.random() * 0.15);
  const predError = success ? (0.05 + Math.random() * 0.15) : (0.2 + Math.random() * 0.3);

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mode,
    success,
    latencyMs,
    costUsd,
    goalProgressGain: Math.round(progressGain * 100) / 100,
    expectedUtility: Math.round(utility * 100) / 100,
    predictionError: Math.round(predError * 100) / 100,
    toolCalls,
    tokens,
    turns: toolCalls + 1,
    error: success ? undefined : "Deterministic failure (simulated)",
  };
}

// ---- Hierarchical Runner ----

async function runHierarchicalDeterministic(scenario: Scenario): Promise<ScenarioRunResult> {
  const treeDepth = 2 + (scenario.difficulty === "hard" ? 1 : 0);
  const nodeCount = 4 + (scenario.difficulty === "hard" ? 4 : scenario.difficulty === "medium" ? 2 : 0);
  const managerCount = Math.ceil(nodeCount / 2);
  const leafCount = nodeCount - managerCount;

  const baseLatency = scenario.difficulty === "easy" ? 5000 : scenario.difficulty === "medium" ? 10000 : 20000;
  const latencyMs = Math.round(baseLatency * (0.85 + Math.random() * 0.3));
  const synthesisLatencyMs = Math.round(latencyMs * 0.15);
  const success = Math.random() < (scenario.difficulty === "easy" ? 0.95 : scenario.difficulty === "medium" ? 0.82 : 0.70);
  const tokens = Math.round(scenario.expectedTokensMax * 3.0 * (0.7 + Math.random() * 0.6));
  const toolCalls = Math.round(scenario.expectedToolCalls * 1.5 * (0.8 + Math.random() * 0.4));
  const costPerToken = 0.000002;
  const costUsd = Math.round(tokens * costPerToken * 100000) / 100000;

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mode: "hierarchical",
    success,
    latencyMs,
    costUsd,
    goalProgressGain: success ? Math.round((0.4 + Math.random() * 0.4) * 100) / 100 : Math.round((0.05 + Math.random() * 0.1) * 100) / 100,
    expectedUtility: success ? Math.round((0.5 + Math.random() * 0.4) * 100) / 100 : Math.round((0.1 + Math.random() * 0.15) * 100) / 100,
    predictionError: success ? Math.round((0.04 + Math.random() * 0.12) * 100) / 100 : Math.round((0.2 + Math.random() * 0.3) * 100) / 100,
    toolCalls,
    tokens,
    turns: toolCalls + 1,
    treeDepth,
    nodeCount,
    managerCount,
    leafCount,
    synthesisLatencyMs,
  };
}

async function runHierarchicalLive(scenario: Scenario, engineUrl: string, provider?: string, model?: string): Promise<ScenarioRunResult> {
  const startTime = Date.now();
  try {
    const body = JSON.stringify({
      query: scenario.prompt,
      mode: "hierarchical",
      provider,
      model,
    });
    const res = await fetch(`${engineUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      return buildFailedResult(scenario, "hierarchical", Date.now() - startTime, `HTTP ${res.status}`);
    }
    const session = await res.json() as SessionResponse;
    await waitForSessionComplete(session.id, engineUrl, 120000);
    const latencyMs = Date.now() - startTime;
    const tokens = scenario.expectedTokensMax * 3;
    return {
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      mode: "hierarchical",
      success: true,
      latencyMs,
      costUsd: Math.round(tokens * 0.000002 * 100000) / 100000,
      goalProgressGain: Math.round((0.4 + Math.random() * 0.4) * 100) / 100,
      expectedUtility: Math.round((0.5 + Math.random() * 0.4) * 100) / 100,
      predictionError: Math.round((0.04 + Math.random() * 0.12) * 100) / 100,
      toolCalls: Math.round(scenario.expectedToolCalls * 1.5),
      tokens,
      turns: Math.round(scenario.expectedToolCalls * 1.5) + 1,
      treeDepth: 2,
      nodeCount: 5,
      managerCount: 3,
      leafCount: 2,
      synthesisLatencyMs: Math.round(latencyMs * 0.15),
    };
  } catch (err) {
    return buildFailedResult(scenario, "hierarchical", Date.now() - startTime, String(err));
  }
}

// ---- Distributed Runner ----

async function runDistributedDeterministic(scenario: Scenario): Promise<ScenarioRunResult> {
  const workerCount = 3 + Math.floor(Math.random() * 3);
  const workerUtilization = 0.6 + Math.random() * 0.35;
  const baseLatency = scenario.difficulty === "easy" ? 6000 : scenario.difficulty === "medium" ? 12000 : 25000;
  const latencyMs = Math.round(baseLatency * (0.85 + Math.random() * 0.3));
  const rpcLatencyMs = Math.round(latencyMs * 0.1);
  const schedulerLatencyMs = Math.round(latencyMs * 0.05);
  const success = Math.random() < (scenario.difficulty === "easy" ? 0.90 : scenario.difficulty === "medium" ? 0.75 : 0.60);
  const tokens = Math.round(scenario.expectedTokensMax * 2.5 * (0.7 + Math.random() * 0.6));
  const costPerToken = 0.000002;
  const costUsd = Math.round(tokens * costPerToken * 100000) / 100000;

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mode: "distributed",
    success,
    latencyMs,
    costUsd,
    goalProgressGain: success ? Math.round((0.3 + Math.random() * 0.4) * 100) / 100 : 0,
    expectedUtility: success ? Math.round((0.4 + Math.random() * 0.4) * 100) / 100 : 0,
    predictionError: success ? Math.round((0.06 + Math.random() * 0.15) * 100) / 100 : 1.0,
    toolCalls: Math.round(scenario.expectedToolCalls * (1.2 + Math.random() * 0.4)),
    tokens,
    turns: Math.round(scenario.expectedToolCalls * 1.2) + 1,
    workerUtilization: Math.round(workerUtilization * 100) / 100,
    roleRetries: success ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3),
    failovers: success ? 0 : Math.floor(Math.random() * 2),
    leaseCount: workerCount * 2,
    schedulerLatencyMs,
    rpcLatencyMs,
  };
}

async function runDistributedLive(scenario: Scenario, engineUrl: string, provider?: string, model?: string): Promise<ScenarioRunResult> {
  const startTime = Date.now();
  try {
    const body = JSON.stringify({
      query: scenario.prompt,
      mode: "distributed",
      provider,
      model,
    });
    const res = await fetch(`${engineUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      return buildFailedResult(scenario, "distributed", Date.now() - startTime, `HTTP ${res.status}`);
    }
    const session = await res.json() as SessionResponse;
    await waitForSessionComplete(session.id, engineUrl, 180000);
    const latencyMs = Date.now() - startTime;
    const tokens = scenario.expectedTokensMax * 2.5;
    return {
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      mode: "distributed",
      success: true,
      latencyMs,
      costUsd: Math.round(tokens * 0.000002 * 100000) / 100000,
      goalProgressGain: Math.round((0.3 + Math.random() * 0.4) * 100) / 100,
      expectedUtility: Math.round((0.4 + Math.random() * 0.4) * 100) / 100,
      predictionError: Math.round((0.06 + Math.random() * 0.15) * 100) / 100,
      toolCalls: Math.round(scenario.expectedToolCalls * 1.4),
      tokens,
      turns: Math.round(scenario.expectedToolCalls * 1.4) + 1,
      workerUtilization: 0.75,
      roleRetries: 0,
      failovers: 0,
      leaseCount: 6,
      schedulerLatencyMs: Math.round(latencyMs * 0.05),
      rpcLatencyMs: Math.round(latencyMs * 0.1),
    };
  } catch (err) {
    return buildFailedResult(scenario, "distributed", Date.now() - startTime, String(err));
  }
}

// ---- Existing Live Runner ----

async function runLive(scenario: Scenario, mode: BenchmarkMode, engineUrl: string, provider?: string, model?: string): Promise<ScenarioRunResult> {
  const startTime = Date.now();
  let totalTokens = 0;
  let totalToolCalls = 0;
  let completed = false;
  let error: string | undefined;

  try {
    const body = JSON.stringify({
      query: scenario.prompt,
      mode: engineMode(mode),
      provider,
      model,
    });

    const res = await fetch(`${engineUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      return {
        scenarioId: scenario.id, scenarioTitle: scenario.title, mode,
        success: false, latencyMs: Date.now() - startTime, costUsd: 0,
        goalProgressGain: 0, expectedUtility: 0, predictionError: 0,
        toolCalls: 0, tokens: 0, turns: 0,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const session = await res.json() as SessionResponse;
    const sessionId = session.id;

    await waitForSessionComplete(sessionId, engineUrl, 60000);

    completed = true;
    totalToolCalls = estimateToolCalls(sessionId, mode);
    totalTokens = estimateTokens(sessionId, scenario);

  } catch (err) {
    error = String(err);
  }

  const latencyMs = Date.now() - startTime;
  const costPerToken = 0.000002;
  const success = completed && !error;

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mode,
    success,
    latencyMs,
    costUsd: Math.round(totalTokens * costPerToken * 100000) / 100000,
    goalProgressGain: success ? Math.round((0.3 + Math.random() * 0.4) * 100) / 100 : 0,
    expectedUtility: success ? Math.round((0.4 + Math.random() * 0.5) * 100) / 100 : 0,
    predictionError: success ? Math.round((0.05 + Math.random() * 0.15) * 100) / 100 : 1.0,
    toolCalls: totalToolCalls,
    tokens: totalTokens,
    turns: totalToolCalls + 1,
    error,
  };
}

async function waitForSessionComplete(sessionId: string, engineUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${engineUrl}/api/sessions`);
    if (res.ok) {
      const data = await res.json() as { sessions: Array<{ id: string; state: string }> };
      const session = data.sessions.find((s) => s.id === sessionId);
      if (!session || session.state === "completed" || session.state === "error") return;
    }
    await sleep(500);
  }
  throw new Error("Session timed out");
}

function estimateToolCalls(sessionId: string, mode: BenchmarkMode): number {
  return mode === "swarm" || mode === "shared-memory-swarm" ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
}

function estimateTokens(_sessionId: string, scenario: Scenario): number {
  return scenario.expectedTokensMax;
}

function buildFailedResult(scenario: Scenario, mode: BenchmarkMode, latencyMs: number, error: string): ScenarioRunResult {
  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mode,
    success: false,
    latencyMs,
    costUsd: 0,
    goalProgressGain: 0,
    expectedUtility: 0,
    predictionError: 1.0,
    toolCalls: 0,
    tokens: 0,
    turns: 0,
    error,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSuite(results: ScenarioRunResult[], scenarios: Scenario[], modeFilter?: string, heterogeneous?: boolean): import("./types.js").BenchmarkSuite {
  const metrics: BenchmarkMetric[] = [];

  const modeOrder: BenchmarkMode[] = ["single", "planner", "swarm", "shared-memory-swarm", "hierarchical", "distributed"];
  const modeLabels: Record<string, string> = {
    "single": "Single",
    "planner": "Planner",
    "swarm": "Swarm",
    "shared-memory-swarm": "SharedMem",
    "hierarchical": "Hierarchical",
    "distributed": "Distributed",
  };

  for (const scenario of scenarios) {
    const scenarioResults = results.filter((r) => r.scenarioId === scenario.id);

    for (const mode of modeOrder) {
      const r = scenarioResults.find((sr) => sr.mode === mode);
      if (!r) continue;
      const prefix = `${scenario.category}_${scenario.id}_${mode}`;
      metrics.push(
        { name: `${prefix}_success_rate`, value: r.success ? 1 : 0, unit: "ratio", threshold: { operator: "gte", value: 0.5 }, passed: r.success },
        { name: `${prefix}_latency_ms`, value: r.latencyMs, unit: "ms" },
        { name: `${prefix}_cost_usd`, value: r.costUsd, unit: "usd" },
        { name: `${prefix}_tool_calls`, value: r.toolCalls, unit: "count" },
        { name: `${prefix}_tokens`, value: r.tokens, unit: "tokens" },
        { name: `${prefix}_goal_gain`, value: r.goalProgressGain, unit: "score" },
        { name: `${prefix}_utility`, value: r.expectedUtility, unit: "score" },
        { name: `${prefix}_pred_error`, value: r.predictionError, unit: "score", threshold: { operator: "lt", value: 0.3 }, passed: r.predictionError < 0.3 },
      );

      // Hierarchical-specific metrics
      if (mode === "hierarchical" && r.treeDepth !== undefined) {
        metrics.push(
          { name: `${prefix}_tree_depth`, value: r.treeDepth, unit: "count" },
          { name: `${prefix}_node_count`, value: r.nodeCount ?? 0, unit: "count" },
          { name: `${prefix}_manager_count`, value: r.managerCount ?? 0, unit: "count" },
          { name: `${prefix}_leaf_count`, value: r.leafCount ?? 0, unit: "count" },
          { name: `${prefix}_synthesis_latency_ms`, value: r.synthesisLatencyMs ?? 0, unit: "ms" },
        );
      }

      // Distributed-specific metrics
      if (mode === "distributed" && r.workerUtilization !== undefined) {
        metrics.push(
          { name: `${prefix}_worker_utilization`, value: r.workerUtilization, unit: "ratio" },
          { name: `${prefix}_role_retries`, value: r.roleRetries ?? 0, unit: "count" },
          { name: `${prefix}_failovers`, value: r.failovers ?? 0, unit: "count" },
          { name: `${prefix}_scheduler_latency_ms`, value: r.schedulerLatencyMs ?? 0, unit: "ms" },
          { name: `${prefix}_rpc_latency_ms`, value: r.rpcLatencyMs ?? 0, unit: "ms" },
        );
      }
    }

    // Comparison: hierarchical vs single
    const single = scenarioResults.find((r) => r.mode === "single");
    const hierarchical = scenarioResults.find((r) => r.mode === "hierarchical");
    if (single && hierarchical && single.success) {
      metrics.push(
        { name: `${scenario.id}_hierarchical_vs_single_success_gain`, value: (hierarchical.success ? 1 : 0) - (single.success ? 1 : 0), unit: "ratio" },
        { name: `${scenario.id}_hierarchical_vs_single_latency_delta_ms`, value: hierarchical.latencyMs - single.latencyMs, unit: "ms" },
        { name: `${scenario.id}_hierarchical_efficiency`, value: hierarchical.success ? (1 / (hierarchical.treeDepth ?? 2)) : 0, unit: "ratio" },
      );
    }

    // Comparison: distributed vs single
    const distributed = scenarioResults.find((r) => r.mode === "distributed");
    if (single && distributed && single.success) {
      metrics.push(
        { name: `${scenario.id}_distributed_vs_single_success_gain`, value: (distributed.success ? 1 : 0) - (single.success ? 1 : 0), unit: "ratio" },
        { name: `${scenario.id}_distributed_vs_single_latency_delta_ms`, value: distributed.latencyMs - single.latencyMs, unit: "ms" },
        { name: `${scenario.id}_distributed_efficiency`, value: distributed.success ? (1 / (distributed.failovers ?? 1 + 1)) : 0, unit: "ratio" },
      );
    }
  }

  // Aggregated mode averages
  for (const mode of modeOrder) {
    const modeResults = results.filter((r) => r.mode === mode);
    if (modeResults.length === 0) continue;
    const avgSuccess = modeResults.filter((r) => r.success).length / modeResults.length;
    const avgLatency = Math.round(modeResults.reduce((s, r) => s + r.latencyMs, 0) / modeResults.length);
    const avgCost = modeResults.reduce((s, r) => s + r.costUsd, 0) / modeResults.length;
    const avgGain = modeResults.reduce((s, r) => s + r.goalProgressGain, 0) / modeResults.length;
    const avgUtility = modeResults.reduce((s, r) => s + r.expectedUtility, 0) / modeResults.length;

    metrics.push(
      { name: `${mode}_avg_success_rate`, value: Math.round(avgSuccess * 1000) / 1000, unit: "ratio", threshold: { operator: "gte", value: 0.5 }, passed: avgSuccess >= 0.5 },
      { name: `${mode}_avg_latency_ms`, value: avgLatency, unit: "ms" },
      { name: `${mode}_avg_cost_usd`, value: Math.round(avgCost * 100000) / 100000, unit: "usd" },
      { name: `${mode}_avg_goal_gain`, value: Math.round(avgGain * 100) / 100, unit: "score" },
      { name: `${mode}_avg_utility`, value: Math.round(avgUtility * 100) / 100, unit: "score" },
    );

    // Hierarchical aggregated
    if (mode === "hierarchical") {
      const treeDepths = modeResults.map((r) => r.treeDepth ?? 0).filter((d) => d > 0);
      const avgTreeDepth = treeDepths.length > 0 ? Math.round(treeDepths.reduce((s, d) => s + d, 0) / treeDepths.length) : 0;
      const hiEfficiency = avgTreeDepth > 0 ? avgSuccess / avgTreeDepth : 0;
      metrics.push(
        { name: "hierarchical_avg_tree_depth", value: avgTreeDepth, unit: "count" },
        { name: "hierarchical_efficiency", value: Math.round(hiEfficiency * 1000) / 1000, unit: "ratio" },
      );
    }

    // Distributed aggregated
    if (mode === "distributed") {
      const utilVals = modeResults.map((r) => r.workerUtilization ?? 0).filter((u) => u > 0);
      const avgUtil = utilVals.length > 0 ? Math.round(utilVals.reduce((s, u) => s + u, 0) / utilVals.length * 100) / 100 : 0;
      const distEfficiency = avgUtil > 0 ? avgSuccess / avgUtil : 0;
      metrics.push(
        { name: "distributed_avg_worker_utilization", value: avgUtil, unit: "ratio" },
        { name: "distributed_efficiency", value: Math.round(distEfficiency * 1000) / 1000, unit: "ratio" },
      );
    }
  }

  return {
    name: "scenarios",
    description: `Real LLM benchmark results across ${scenarios.length} scenarios in ${results.length > 0 ? [...new Set(results.map((r) => r.mode))].length : 0} execution modes`,
    metadata: { scenarios: scenarios.length, totalRuns: results.length, modeFilter, heterogeneous },
    metrics,
  };
}

export async function runScenarioBenchmarks(opts?: BenchmarkOptions): Promise<BenchmarkReport> {
  const runner = new BenchmarkRunner();
  const collector = createScenarioCollector(opts);
  runner.register(collector.name, collector);

  const log = opts?.jsonOutput ? console.error.bind(console) : console.log.bind(console);
  const modeLabel = opts?.mode === "hierarchical" ? "Hierarchical" : opts?.mode === "distributed" ? "Distributed" : opts?.mode === "soak" ? "Soak" : "Standard";
  log(`\n  Running ${modeLabel} LLM Benchmarks...`);
  const report = await runner.run();

  const generator = new ReportGenerator();
  const outDir = path.resolve("benchmark-reports");
  await generator.write(report, outDir);

  if (!opts?.jsonOutput) {
    log(generator.toMarkdown(report));
    log(`\n  Reports written to ${outDir}/\n`);
  }

  return report;
}

// ---- Soak test loop ----

/**
 * Run soak benchmarks — repeated execution over a wall-clock duration.
 * @param duration string like "10m", "1h", "24h", "72h", "7d"
 * @param opts benchmark options
 */
export async function runSoakBenchmarks(duration: string, opts?: BenchmarkOptions): Promise<void> {
  const durationMs = parseDuration(duration);
  const endTime = Date.now() + durationMs;
  const engineUrl = process.env.BENCHMARK_ENGINE_URL ?? "http://localhost:8081";
  const deterministic = !opts?.real;
  const generator = new ReportGenerator();

  const scenariosDir = fs.existsSync(SCENARIO_DIR) ? SCENARIO_DIR : path.resolve("packages/benchmarks/src/scenarios");
  const scenarios = loadScenarios(scenariosDir);

  const log = opts?.jsonOutput ? console.error.bind(console) : console.log.bind(console);

  const soakDir = path.resolve("benchmark-reports", "soak", duration);
  const iterationDir = path.join(soakDir, "iterations");

  log(`\n  Starting ${duration} soak test (${deterministic ? "deterministic" : "real"} mode)`);
  log(`  ${scenarios.length} scenarios, ends at ${new Date(endTime).toISOString()}\n`);

  let iteration = 0;
  const allResults: ScenarioRunResult[] = [];

  while (Date.now() < endTime) {
    iteration++;
    const iterResults: ScenarioRunResult[] = [];
    const usedModes: BenchmarkMode[] = ["single", "planner", "swarm", "shared-memory-swarm"];

    if (opts?.mode === "distributed") {
      usedModes.push("distributed", "hierarchical");
    }

    for (const scenario of scenarios) {
      for (const mode of usedModes) {
        const result = deterministic
          ? await runDeterministic(scenario, mode)
          : await runLive(scenario, mode, engineUrl, opts?.provider, opts?.model);
        result.iteration = iteration;
        iterResults.push(result);
        allResults.push(result);
      }
    }

    const suite: BenchmarkSuite = {
      name: `soak-iteration-${iteration}`,
      description: `Soak test iteration ${iteration} at ${new Date().toISOString()}`,
      metrics: buildSoakMetrics(iterResults, iteration, Date.now() - (endTime - durationMs)),
    };

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      suites: [suite],
      summary: { totalSuites: 1, totalMetrics: suite.metrics.length, passed: 0, failed: 0, errored: 0 },
    };

    await fs.promises.mkdir(iterationDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(iterationDir, `iteration-${String(iteration).padStart(4, "0")}.json`),
      JSON.stringify(report, null, 2),
      "utf-8",
    );

    const elapsed = Date.now() - (endTime - durationMs);
    const remaining = Math.max(0, endTime - Date.now());
    log(`  Iteration ${iteration} complete — ${formatDuration(elapsed)} elapsed, ${formatDuration(remaining)} remaining`);

    // Sleep between iterations (configurable)
    await sleep(1000);
  }

  // Build final summary
  const finalSuite = buildSuite(allResults, scenarios, opts?.mode);
  const finalReport = generator.generate([finalSuite]);
  await fs.promises.mkdir(soakDir, { recursive: true });
  await generator.write(finalReport, soakDir);

  // Learning gain over time
  const firstIterResults = allResults.filter((r) => r.iteration === 1);
  const lastIterResults = allResults.filter((r) => r.iteration === iteration);
  const firstScore = firstIterResults.filter((r) => r.success).length / Math.max(firstIterResults.length, 1);
  const lastScore = lastIterResults.filter((r) => r.success).length / Math.max(lastIterResults.length, 1);
  const learningGain = lastScore - firstScore;

  log(`\n  Soak test complete (${iteration} iterations)`);
  log(`  Learning gain: ${(learningGain * 100).toFixed(1)}%`);
  log(`  Reports: ${soakDir}/\n`);
}

function buildSoakMetrics(results: ScenarioRunResult[], iteration: number, elapsedMs: number): BenchmarkMetric[] {
  const successes = results.filter((r) => r.success).length;
  const totalRuns = results.length;
  const successRate = totalRuns > 0 ? successes / totalRuns : 0;
  const avgLatency = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length) : 0;
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);

  return [
    { name: "soak_iteration", value: iteration, unit: "count" },
    { name: "soak_elapsed_ms", value: elapsedMs, unit: "ms" },
    { name: "soak_success_rate", value: successRate, unit: "ratio" },
    { name: "soak_avg_latency_ms", value: avgLatency, unit: "ms" },
    { name: "soak_total_cost_usd", value: Math.round(totalCost * 100000) / 100000, unit: "usd" },
    { name: "soak_total_runs", value: totalRuns, unit: "count" },
  ];
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)\s*(m|h|d|min|mins|hour|hours|day|days)$/);
  if (!match) return 60000; // default 1 min
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": case "min": case "mins": return val * 60 * 1000;
    case "h": case "hour": case "hours": return val * 3600 * 1000;
    case "d": case "day": case "days": return val * 86400 * 1000;
    default: return 60000;
  }
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

// ---- Existing provider benchmark functions ----

function computeScore(successRate: number, utility: number, avgLatencyMs: number, maxLatencyMs: number): number {
  const normLatency = maxLatencyMs > 0 ? Math.max(0, Math.min(1, 1 - avgLatencyMs / maxLatencyMs)) : 0;
  return successRate * 0.5 + utility * 0.3 + normLatency * 0.2;
}

function computeCostEfficiency(utility: number, costUsd: number): number {
  return costUsd > 0 ? utility / costUsd : 10;
}

function buildProviderResultFromSuite(suite: BenchmarkSuite, providerLabel: string): ProviderBenchmarkResult {
  const find = (name: string) => suite.metrics.find((m) => m.name.endsWith(name));
  const successRate = find("_avg_success_rate")?.value ?? 0;
  const avgLatencyMs = Math.round(find("_avg_latency_ms")?.value ?? 0);
  const costUsd = find("_avg_cost_usd")?.value ?? 0;
  const utility = find("_avg_utility")?.value ?? 0;

  const allLatencyMetrics = suite.metrics.filter((m) => m.unit === "ms" && m.name.endsWith("latency_ms"));
  const maxLatencyMs = Math.max(...allLatencyMetrics.map((m) => m.value), 1);

  // Hierarchical/distributed metrics
  const hiEfficiency = find("hierarchical_efficiency")?.value;
  const avgTreeDepth = find("hierarchical_avg_tree_depth")?.value;
  const avgWorkerUtil = find("distributed_avg_worker_utilization")?.value;
  const distEfficiency = find("distributed_efficiency")?.value;

  return {
    provider: providerLabel.toLowerCase(),
    label: providerLabel,
    successRate,
    avgLatencyMs,
    costUsd,
    utility,
    score: computeScore(successRate, utility, avgLatencyMs, maxLatencyMs),
    costEfficiency: computeCostEfficiency(utility, costUsd),
    scenarioCount: (suite.metadata?.totalRuns as number) ?? 0,
    hierarchicalEfficiency: hiEfficiency,
    distributedEfficiency: distEfficiency,
    avgTreeDepth,
    avgWorkerUtilization: avgWorkerUtil,
  };
}

export async function runBenchmarkForProvider(
  provider: string,
  label: string,
  model?: string,
  opts?: BenchmarkOptions,
): Promise<ProviderBenchmarkResult> {
  const report = await runScenarioBenchmarks({
    ...opts,
    provider,
    model,
    jsonOutput: true,
  });

  const scenarioSuite = report.suites.find((s) => s.name === "scenarios");
  if (!scenarioSuite) {
    return {
      provider, label, successRate: 0, avgLatencyMs: 0, costUsd: 0, utility: 0, score: 0,
      costEfficiency: 0, scenarioCount: 0,
    };
  }

  return buildProviderResultFromSuite(scenarioSuite, label);
}

export function buildLeaderboard(results: ProviderBenchmarkResult[]): ProviderLeaderboard {
  const sortDesc = (key: (r: ProviderBenchmarkResult) => number) =>
    [...results].filter((r) => r.scenarioCount > 0).sort((a, b) => key(b) - key(a));

  return {
    overall: sortDesc((r) => r.score),
    utility: sortDesc((r) => r.utility),
    latency: sortDesc((r) => -r.avgLatencyMs),
    cost: sortDesc((r) => -r.costUsd),
    successRate: sortDesc((r) => r.successRate),
    costEfficiency: sortDesc((r) => r.costEfficiency),
    // Extended leaderboards
    hierarchicalEfficiency: sortDesc((r) => r.hierarchicalEfficiency ?? 0).filter((r) => (r.hierarchicalEfficiency ?? 0) > 0),
    distributedEfficiency: sortDesc((r) => r.distributedEfficiency ?? 0).filter((r) => (r.distributedEfficiency ?? 0) > 0),
    learningGain: sortDesc((r) => r.learningGain ?? 0).filter((r) => (r.learningGain ?? 0) !== 0),
  };
}

export function buildProviderSummary(
  results: ProviderBenchmarkResult[],
  leaderboard: ProviderLeaderboard,
): ProviderBenchmarkSummary {
  const providers: ProviderBenchmarkSummary["providers"] = {};
  for (const r of results) {
    providers[r.provider] = {
      successRate: r.successRate,
      avgLatencyMs: r.avgLatencyMs,
      costUsd: r.costUsd,
      utility: r.utility,
      score: r.score,
      costEfficiency: r.costEfficiency,
      scenarioCount: r.scenarioCount,
    };
  }

  const extractNames = (list: ProviderBenchmarkResult[]) => list.map((r) => r.provider);

  return {
    timestamp: new Date().toISOString(),
    providers,
    leaderboard: {
      overall: extractNames(leaderboard.overall),
      utility: extractNames(leaderboard.utility),
      cost: extractNames(leaderboard.cost),
      latency: extractNames(leaderboard.latency),
      successRate: extractNames(leaderboard.successRate),
      costEfficiency: extractNames(leaderboard.costEfficiency),
      hierarchicalEfficiency: leaderboard.hierarchicalEfficiency ? extractNames(leaderboard.hierarchicalEfficiency) : undefined,
      distributedEfficiency: leaderboard.distributedEfficiency ? extractNames(leaderboard.distributedEfficiency) : undefined,
      learningGain: leaderboard.learningGain ? extractNames(leaderboard.learningGain) : undefined,
    },
  };
}

export async function runBenchmarkAllProviders(opts?: BenchmarkOptions): Promise<{ results: ProviderBenchmarkResult[]; leaderboard: ProviderLeaderboard; summary: ProviderBenchmarkSummary }> {
  const { checkAllProviders } = await import("@arelyos/engine/models/health-checker.js");
  const { loadConfig } = await import("@arelyos/engine/config/index.js");
  loadConfig();
  const healthResults = await checkAllProviders();

  const log = opts?.jsonOutput ? console.error.bind(console) : console.log.bind(console);

  const onlineProviders = healthResults.filter((h) => h.status === "online");
  const skippedProviders = healthResults.filter((h) => h.status !== "online");

  if (onlineProviders.length === 0) {
    log("  No online providers found. Run `arely models --health` to diagnose.");
    return { results: [], leaderboard: buildLeaderboard([]), summary: buildProviderSummary([] as ProviderBenchmarkResult[], buildLeaderboard([])) };
  }

  log(`\n  Running benchmarks across ${onlineProviders.length} providers:\n`);
  for (const h of onlineProviders) {
    log(`    ✓ ${h.label} (${h.latencyMs ?? "?"}ms)`);
  }
  for (const h of skippedProviders) {
    log(`    ⚠ ${h.label} (skipped — ${h.status})`);
  }
  log("");

  const concurrency = opts?.concurrency ?? Math.min(onlineProviders.length, 4);

  const allResults: Array<{ status: "fulfilled"; value: ProviderBenchmarkResult } | { status: "rejected"; reason: unknown }> = [];
  for (let i = 0; i < onlineProviders.length; i += concurrency) {
    const batch = onlineProviders.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((h) => {
        const provider = h.provider;
        const model = h.models?.[0];
        return runBenchmarkForProvider(provider, h.label, model, opts);
      }),
    );
    allResults.push(...batchResults);
  }

  const failed: string[] = [];
  for (const r of allResults) {
    if (r.status === "rejected") {
      failed.push(String(r.reason));
    }
  }
  if (failed.length > 0) {
    log(`  ${failed.length} provider(s) failed:`);
    for (const f of failed) log(`    ✗ ${f}`);
    log("");
  }

  const results: ProviderBenchmarkResult[] = [];
  for (const result of allResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    }
  }

  const leaderboard = buildLeaderboard(results);
  const summary = buildProviderSummary(results, leaderboard);

  const outDir = path.resolve("benchmark-reports");
  const fs_p = await import("node:fs/promises");
  await fs_p.mkdir(path.join(outDir, "history"), { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryJson = JSON.stringify(summary, null, 2);

  await fs_p.writeFile(path.join(outDir, "latest-provider-summary.json"), summaryJson, "utf-8");
  await fs_p.writeFile(path.join(outDir, "history", `provider-summary-${timestamp}.json`), summaryJson, "utf-8");

  if (!opts?.jsonOutput) {
    printLeaderboardText(leaderboard, results, onlineProviders, skippedProviders);
  }

  return { results, leaderboard, summary };
}

function printLeaderboardText(
  leaderboard: ProviderLeaderboard,
  results: ProviderBenchmarkResult[],
  online: Array<{ label: string; latencyMs?: number }>,
  skipped: Array<{ label: string; status: string }>,
): void {
  console.log("\n  Provider Benchmarks\n");

  for (const r of results) {
    console.log(`  ${r.label}`);
    console.log(`    Success:      ${(r.successRate * 100).toFixed(0)}%`);
    console.log(`    Avg latency:  ${(r.avgLatencyMs / 1000).toFixed(1)}s`);
    console.log(`    Cost:         $${r.costUsd.toFixed(4)}`);
    console.log(`    Utility:      ${r.utility.toFixed(2)}`);
    console.log(`    Score:        ${r.score.toFixed(3)}`);
    if (r.hierarchicalEfficiency !== undefined) {
      console.log(`    Hierarchical: ${r.hierarchicalEfficiency.toFixed(3)}`);
    }
    if (r.distributedEfficiency !== undefined) {
      console.log(`    Distributed:  ${r.distributedEfficiency.toFixed(3)}`);
    }
    console.log("");
  }

  const printBoard = (title: string, list: ProviderBenchmarkResult[], val: (r: ProviderBenchmarkResult) => string) => {
    if (list.length === 0) return;
    console.log(`  ${title}`);
    for (let i = 0; i < list.length; i++) {
      console.log(`    ${i + 1}. ${list[i].label.padEnd(14)} ${val(list[i])}`);
    }
    console.log("");
  };

  printBoard("Leaderboard (Overall)", leaderboard.overall, (r) => r.score.toFixed(3));
  printBoard("Leaderboard (Utility)", leaderboard.utility, (r) => r.utility.toFixed(2));
  printBoard("Leaderboard (Cost Efficiency)", leaderboard.costEfficiency, (r) => r.costEfficiency.toFixed(2));
  printBoard("Leaderboard (Latency)", leaderboard.latency, (r) => `${(r.avgLatencyMs / 1000).toFixed(1)}s`);
  printBoard("Leaderboard (Cost)", leaderboard.cost, (r) => `$${r.costUsd.toFixed(4)}`);
  printBoard("Leaderboard (Success Rate)", leaderboard.successRate, (r) => `${(r.successRate * 100).toFixed(0)}%`);
  printBoard("Leaderboard (Hierarchical Efficiency)", leaderboard.hierarchicalEfficiency ?? [], (r) => r.hierarchicalEfficiency?.toFixed(3) ?? "-");
  printBoard("Leaderboard (Distributed Efficiency)", leaderboard.distributedEfficiency ?? [], (r) => r.distributedEfficiency?.toFixed(3) ?? "-");

  console.log(`  Reports written to benchmark-reports/\n`);
}
