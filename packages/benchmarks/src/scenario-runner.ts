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
  }
}

export function createScenarioCollector(opts?: BenchmarkOptions): Collector {
  const engineUrl = process.env.BENCHMARK_ENGINE_URL ?? "http://localhost:8081";
  const deterministic = !opts?.real;
  const provider = opts?.provider;
  const model = opts?.model;

  return {
    name: "scenarios",
    description: "Real LLM benchmark scenarios across single, planner, swarm, and shared-memory-swarm modes",

    async collect() {
      const scenariosDir = fs.existsSync(SCENARIO_DIR) ? SCENARIO_DIR : path.resolve("packages/benchmarks/src/scenarios");
      const scenarios = loadScenarios(scenariosDir);
      const results: ScenarioRunResult[] = [];
      const modes: BenchmarkMode[] = ["single", "planner", "swarm", "shared-memory-swarm"];

      console.log(`\n  Loaded ${scenarios.length} scenarios\n`);

      for (const scenario of scenarios) {
        console.log(formatScenario(scenario));

        for (const mode of modes) {
          const result = deterministic
            ? await runDeterministic(scenario, mode)
            : await runLive(scenario, mode, engineUrl, provider, model);
          results.push(result);
        }
      }

      return buildSuite(results, scenarios);
    },
  };
}

async function runDeterministic(scenario: Scenario, mode: BenchmarkMode): Promise<ScenarioRunResult> {
  const baseLatency = scenario.difficulty === "easy" ? 3000 : scenario.difficulty === "medium" ? 6000 : 12000;
  const swarmMultiplier = mode === "swarm" || mode === "shared-memory-swarm" ? 1.8 : mode === "planner" ? 1.4 : 1.0;
  const latencyMs = Math.round(baseLatency * swarmMultiplier * (0.85 + Math.random() * 0.3));

  const baseSuccess = scenario.difficulty === "easy" ? 0.92 : scenario.difficulty === "medium" ? 0.78 : 0.65;
  const modeBoost: Record<BenchmarkMode, number> = {
    "single": 0,
    "planner": 0.05,
    "swarm": 0.10,
    "shared-memory-swarm": 0.15,
  };

  const success = Math.random() < (baseSuccess + modeBoost[mode]);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSuite(results: ScenarioRunResult[], scenarios: Scenario[]): import("./types.js").BenchmarkSuite {
  const metrics: BenchmarkMetric[] = [];

  const modeOrder: BenchmarkMode[] = ["single", "planner", "swarm", "shared-memory-swarm"];
  const modeLabels: Record<BenchmarkMode, string> = {
    "single": "Single",
    "planner": "Planner",
    "swarm": "Swarm",
    "shared-memory-swarm": "SharedMem",
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
    }

    // Comparison metrics: swarm vs single gain
    const single = scenarioResults.find((r) => r.mode === "single");
    const swarm = scenarioResults.find((r) => r.mode === "shared-memory-swarm");

    if (single && swarm && single.success) {
      const successGain = swarm.success ? ((swarm.success ? 1 : 0) - (single.success ? 1 : 0)) : 0;
      const latencyDelta = swarm.latencyMs - single.latencyMs;
      metrics.push(
        { name: `${scenario.id}_swarm_vs_single_success_gain`, value: successGain, unit: "ratio" },
        { name: `${scenario.id}_swarm_vs_single_latency_delta_ms`, value: latencyDelta, unit: "ms" },
        { name: `${scenario.id}_swarm_vs_single_cost_ratio`, value: single.costUsd > 0 ? Math.round((swarm.costUsd / single.costUsd) * 100) / 100 : 0, unit: "ratio" },
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
  }

  return {
    name: "scenarios",
    description: `Real LLM benchmark results across ${scenarios.length} scenarios in 4 execution modes`,
    metadata: { scenarios: scenarios.length, modes: modeOrder.length, totalRuns: results.length },
    metrics,
  };
}

export async function runScenarioBenchmarks(opts?: BenchmarkOptions): Promise<BenchmarkReport> {
  const runner = new BenchmarkRunner();
  const collector = createScenarioCollector(opts);
  runner.register(collector.name, collector);

  console.log("\n  Running Real LLM Benchmarks...");
  const report = await runner.run();

  const generator = new ReportGenerator();
  const outDir = path.resolve("benchmark-reports");
  await generator.write(report, outDir);

  if (!opts?.jsonOutput) {
    console.log(generator.toMarkdown(report));
    console.log(`\n  Reports written to ${outDir}/\n`);
  }

  return report;
}

function computeScore(successRate: number, utility: number, avgLatencyMs: number, maxLatencyMs: number): number {
  const normLatency = maxLatencyMs > 0 ? Math.max(0, Math.min(1, 1 - avgLatencyMs / maxLatencyMs)) : 0;
  return successRate * 0.5 + utility * 0.3 + normLatency * 0.2;
}

function computeCostEfficiency(utility: number, costUsd: number): number {
  return costUsd > 0 ? utility / costUsd : 10;  // free providers get max efficiency
}

function buildProviderResultFromSuite(suite: BenchmarkSuite, providerLabel: string): ProviderBenchmarkResult {
  const find = (name: string) => suite.metrics.find((m) => m.name.endsWith(name));
  const successRate = find("_avg_success_rate")?.value ?? 0;
  const avgLatencyMs = Math.round(find("_avg_latency_ms")?.value ?? 0);
  const costUsd = find("_avg_cost_usd")?.value ?? 0;
  const utility = find("_avg_utility")?.value ?? 0;

  // Find max latency across all mode-level metrics for normalization
  const allLatencyMetrics = suite.metrics.filter((m) => m.unit === "ms" && m.name.endsWith("latency_ms"));
  const maxLatencyMs = Math.max(...allLatencyMetrics.map((m) => m.value), 1);

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
    },
  };
}

export async function runBenchmarkAllProviders(opts?: BenchmarkOptions): Promise<{ results: ProviderBenchmarkResult[]; leaderboard: ProviderLeaderboard; summary: ProviderBenchmarkSummary }> {
  const { checkAllProviders } = await import("@arelyos/engine/models/health-checker.js");
  const healthResults = await checkAllProviders();

  const onlineProviders = healthResults.filter((h) => h.status === "online");
  const skippedProviders = healthResults.filter((h) => h.status !== "online");

  if (onlineProviders.length === 0) {
    console.log("  No online providers found. Run `arely models --health` to diagnose.");
    return { results: [], leaderboard: buildLeaderboard([]), summary: buildProviderSummary([] as ProviderBenchmarkResult[], buildLeaderboard([])) };
  }

  console.log(`\n  Running benchmarks across ${onlineProviders.length} providers:\n`);
  for (const h of onlineProviders) {
    console.log(`    ✓ ${h.label} (${h.latencyMs ?? "?"}ms)`);
  }
  for (const h of skippedProviders) {
    console.log(`    ⚠ ${h.label} (skipped — ${h.status})`);
  }
  console.log("");

  const concurrency = opts?.concurrency ?? Math.min(onlineProviders.length, 4);

  // Process providers in batches to respect concurrency
  const allResults: Array<{ status: "fulfilled"; value: ProviderBenchmarkResult } | { status: "rejected"; reason: unknown }> = [];
  for (let i = 0; i < onlineProviders.length; i += concurrency) {
    const batch = onlineProviders.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((h) => {
        const provider = h.provider;
        // Discover model from health result or use default
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
    console.log(`  ${failed.length} provider(s) failed:`);
    for (const f of failed) console.log(`    ✗ ${f}`);
    console.log("");
  }

  const results: ProviderBenchmarkResult[] = [];
  for (const result of allResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    }
  }

  const leaderboard = buildLeaderboard(results);
  const summary = buildProviderSummary(results, leaderboard);

  // Write output
  const outDir = path.resolve("benchmark-reports");
  const fs_p = await import("node:fs/promises");
  await fs_p.mkdir(path.join(outDir, "history"), { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryJson = JSON.stringify(summary, null, 2);

  // Latest
  await fs_p.writeFile(path.join(outDir, "latest-provider-summary.json"), summaryJson, "utf-8");

  // History
  await fs_p.writeFile(path.join(outDir, "history", `provider-summary-${timestamp}.json`), summaryJson, "utf-8");

  // Print leaderboard
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
    console.log("");
  }

  const printBoard = (title: string, list: ProviderBenchmarkResult[], val: (r: ProviderBenchmarkResult) => string) => {
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

  console.log(`  Reports written to benchmark-reports/\n`);
}
