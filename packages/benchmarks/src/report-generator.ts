import type { BenchmarkReport, BenchmarkSuite, BenchmarkMetric } from "./types.js";

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
}
