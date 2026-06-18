#!/usr/bin/env tsx

import { runScenarioBenchmarks, runBenchmarkAllProviders, runSoakBenchmarks } from "./scenario-runner.js";
import type { BenchmarkOptions } from "./types.js";

async function main() {
  const args = process.argv.slice(2);
  const useReal = args.includes("--real") || args.includes("-r");
  const useJson = args.includes("--json");
  const engineUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1] ?? "http://localhost:8081";

  const providerIdx = args.indexOf("--provider");
  const providerFilter = providerIdx !== -1 && args[providerIdx + 1] ? args[providerIdx + 1] : undefined;

  const environmentIdx = args.indexOf("--environment");
  const environment = environmentIdx !== -1 && args[environmentIdx + 1]
    ? args[environmentIdx + 1] as "dev" | "ci" | "production"
    : undefined;

  const concurrencyIdx = args.indexOf("--concurrency");
  const concurrency = concurrencyIdx !== -1 && args[concurrencyIdx + 1]
    ? parseInt(args[concurrencyIdx + 1], 10)
    : undefined;

  // Sprint 1 flags
  const hierarchicalMode = args.includes("--manager-hierarchical");
  const distributedMode = args.includes("--distributed");
  const swarmHeterogeneous = args.includes("--swarm-heterogeneous");
  const durationIdx = args.indexOf("--duration");
  const duration = durationIdx !== -1 && args[durationIdx + 1] ? args[durationIdx + 1] : undefined;

  // Determine mode
  let mode: BenchmarkOptions["mode"] = "standard";
  if (hierarchicalMode) mode = "hierarchical";
  else if (distributedMode) mode = "distributed";
  else if (swarmHeterogeneous) mode = "swarm-heterogeneous";
  else if (duration) mode = "soak";

  process.env.BENCHMARK_ENGINE_URL = engineUrl;

  // Handle --provider all
  if (providerFilter === "all" && useReal) {
    const result = await runBenchmarkAllProviders({
      real: true,
      jsonOutput: useJson,
      environment,
      concurrency,
      mode,
    });
    if (useJson) {
      console.log(JSON.stringify({ results: result.results, leaderboard: result.leaderboard, summary: result.summary }, null, 2));
    }
    return;
  }

  // Handle soak mode
  if (duration && mode === "soak") {
    const log = useJson ? console.error.bind(console) : console.log.bind(console);
    log(`\n  ARELY Soak Benchmarks — ${useReal ? "REAL LLM" : "Deterministic"} mode`);
    log(`  Duration: ${duration}`);
    if (distributedMode) log("  Mode: distributed");

    await runSoakBenchmarks(duration, {
      real: useReal,
      jsonOutput: useJson,
      environment,
      concurrency,
      mode: distributedMode ? "distributed" : "standard",
      provider: providerFilter,
    });

    if (useJson) {
      // Soak outputs per-iteration JSON files in benchmark-reports/soak/
      console.log(JSON.stringify({ status: "soak_complete", duration }));
    }
    return;
  }

  // Read multi-provider config for single-provider real mode
  let providerConfig: { provider: string; model: string; apiKey?: string; baseUrl?: string } | undefined;

  if (useReal) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const configPath = path.join(os.homedir(), ".arely", "config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
          defaultProvider?: string;
          defaultModel?: string;
          providers?: Record<string, { enabled?: boolean; apiKey?: string; baseUrl?: string; defaultModel?: string }>;
        };

        const targetProvider: string | undefined = providerFilter ?? config.defaultProvider;
        const pCfg = targetProvider ? config.providers?.[targetProvider] : undefined;

        if (targetProvider && pCfg && pCfg.enabled !== false) {
          const model = pCfg.defaultModel ?? config.defaultModel ?? "";
          providerConfig = {
            provider: targetProvider,
            model,
            apiKey: pCfg.apiKey,
            baseUrl: pCfg.baseUrl,
          };
        }
      }
    } catch {
      // Config not available; run without provider override
    }
  }

  const log = useJson ? console.error.bind(console) : console.log.bind(console);
  const modeLabel = mode === "hierarchical" ? "Hierarchical" : mode === "distributed" ? "Distributed" : mode === "swarm-heterogeneous" ? "Swarm Heterogeneous" : "Standard";
  log(`\n  ARELY Benchmarks — ${useReal ? "REAL LLM" : "Deterministic"} mode [${modeLabel}]`);
  if (providerConfig) {
    log(`  Provider: ${providerConfig.provider} / ${providerConfig.model}`);
  }

  const opts: BenchmarkOptions = {
    real: useReal,
    jsonOutput: useJson,
    environment,
    concurrency,
    mode,
    heterogeneous: swarmHeterogeneous,
  };
  if (providerConfig) {
    opts.provider = providerConfig.provider;
    opts.model = providerConfig.model;
  }

  const report = await runScenarioBenchmarks(opts);
  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error("Benchmark run failed:", err);
  process.exit(1);
});
