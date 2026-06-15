#!/usr/bin/env tsx

import { runScenarioBenchmarks } from "./scenario-runner.js";

async function main() {
  const args = process.argv.slice(2);
  const useReal = args.includes("--real") || args.includes("-r");
  const engineUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1] ?? "http://localhost:8081";

  console.log(`\n  ARELY Benchmarks — ${useReal ? "REAL LLM" : "Deterministic"} mode`);

  await runScenarioBenchmarks({
    engineUrl,
    deterministic: !useReal,
  });
}

main().catch((err) => {
  console.error("Benchmark run failed:", err);
  process.exit(1);
});
