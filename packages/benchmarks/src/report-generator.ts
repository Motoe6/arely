import type { BenchmarkReport, BenchmarkSuite, BenchmarkMetric, ProviderBenchmarkResult, ProviderLeaderboard, ProviderBenchmarkSummary } from "./types.js";

export class ReportGenerator {
  toJSON(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  toMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push(`# Benchmark Report`);
    lines.push(`**Generated:** ${report.timestamp}`);
    lines.push(`**Suites:** ${report.summary.totalSuites}`);
    lines.push(`**Metrics:** ${report.summary.totalMetrics} (${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.errored} errored)`);
    lines.push("");

    for (const suite of report.suites) {
      lines.push(`## ${suite.name}`);
      lines.push(`*${suite.description}*`);
      lines.push("");

      lines.push("| Metric | Value | Unit | Threshold | Status |");
      lines.push("|--------|-------|------|-----------|--------|");

      for (const m of suite.metrics) {
        const thresholdStr = m.threshold
          ? `${m.threshold.operator} ${m.threshold.value}`
          : "-";
        const status = m.passed === true ? "✅" : m.passed === false ? "❌" : "➖";
        lines.push(`| ${m.name} | ${m.value} | ${m.unit} | ${thresholdStr} | ${status} |`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  generate(suites: BenchmarkSuite[]): BenchmarkReport {
    let totalMetrics = 0;
    let passed = 0;
    let failed = 0;
    let errored = 0;

    for (const suite of suites) {
      for (const m of suite.metrics) {
        totalMetrics++;
        if (m.passed === true) passed++;
        else if (m.passed === false) failed++;
        else if (m.threshold && m.passed === undefined) errored++;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      suites,
      summary: { totalSuites: suites.length, totalMetrics, passed, failed, errored },
    };
  }

  async write(report: BenchmarkReport, dir: string): Promise<{ jsonPath: string; mdPath: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(dir, { recursive: true });

    const jsonPath = path.join(dir, "benchmark-report.json");
    const mdPath = path.join(dir, "benchmark-report.md");

    await fs.writeFile(jsonPath, this.toJSON(report), "utf-8");
    await fs.writeFile(mdPath, this.toMarkdown(report), "utf-8");

    return { jsonPath, mdPath };
  }

  toProviderMarkdown(leaderboard: ProviderLeaderboard, results: ProviderBenchmarkResult[]): string {
    const lines: string[] = [];
    lines.push(`# Provider Benchmark Report`);
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Providers tested:** ${results.length}`);
    lines.push("");

    // Individual results
    for (const r of results) {
      lines.push(`## ${r.label}`);
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|------:|`);
      lines.push(`| Success Rate | ${(r.successRate * 100).toFixed(1)}% |`);
      lines.push(`| Avg Latency | ${(r.avgLatencyMs / 1000).toFixed(1)}s |`);
      lines.push(`| Cost | $${r.costUsd.toFixed(6)} |`);
      lines.push(`| Utility | ${r.utility.toFixed(3)} |`);
      lines.push(`| Score | ${r.score.toFixed(3)} |`);
      lines.push(`| Cost Efficiency | ${r.costEfficiency.toFixed(2)} |`);
      lines.push(`| Scenarios | ${r.scenarioCount} |`);
      lines.push("");
    }

    const printBoard = (title: string, list: ProviderBenchmarkResult[], val: (r: ProviderBenchmarkResult) => string) => {
      lines.push(`## ${title}`);
      lines.push("| Rank | Provider | Value |");
      lines.push("|------|----------|------:|");
      for (let i = 0; i < list.length; i++) {
        lines.push(`| ${i + 1} | ${list[i].label} | ${val(list[i])} |`);
      }
      lines.push("");
    };

    printBoard("Leaderboard (Overall)", leaderboard.overall, (r) => r.score.toFixed(3));
    printBoard("Leaderboard (Utility)", leaderboard.utility, (r) => r.utility.toFixed(3));
    printBoard("Leaderboard (Cost Efficiency)", leaderboard.costEfficiency, (r) => r.costEfficiency.toFixed(2));
    printBoard("Leaderboard (Latency)", leaderboard.latency, (r) => `${(r.avgLatencyMs / 1000).toFixed(1)}s`);
    printBoard("Leaderboard (Cost)", leaderboard.cost, (r) => `$${r.costUsd.toFixed(6)}`);
    printBoard("Leaderboard (Success Rate)", leaderboard.successRate, (r) => `${(r.successRate * 100).toFixed(1)}%`);

    // Extended leaderboards (Sprint 1)
    if (leaderboard.hierarchicalEfficiency && leaderboard.hierarchicalEfficiency.length > 0) {
      printBoard("Leaderboard (Hierarchical Efficiency)", leaderboard.hierarchicalEfficiency, (r) => r.hierarchicalEfficiency?.toFixed(3) ?? "-");
    }
    if (leaderboard.distributedEfficiency && leaderboard.distributedEfficiency.length > 0) {
      printBoard("Leaderboard (Distributed Efficiency)", leaderboard.distributedEfficiency, (r) => r.distributedEfficiency?.toFixed(3) ?? "-");
    }
    if (leaderboard.learningGain && leaderboard.learningGain.length > 0) {
      printBoard("Leaderboard (Learning Gain)", leaderboard.learningGain, (r) => r.learningGain?.toFixed(4) ?? "-");
    }

    return lines.join("\n");
  }
}
