import { describe, it, expect } from "vitest";
import { ReportGenerator } from "@arelyos/benchmarks/report-generator.js";
import type { BenchmarkSuite } from "@arelyos/benchmarks/types.js";

describe("ReportGenerator", () => {
  const generator = new ReportGenerator();

  it("generate produces correct summary with passed/failed/errored", () => {
    const suites: BenchmarkSuite[] = [
      {
        name: "test", description: "test suite",
        metrics: [
          { name: "pass", value: 1, unit: "count", threshold: { operator: "gte", value: 1 }, passed: true },
          { name: "fail", value: 0, unit: "count", threshold: { operator: "gte", value: 1 }, passed: false },
          { name: "nothreshold", value: 5, unit: "count" },
        ],
      },
    ];

    const report = generator.generate(suites);
    expect(report.summary.totalSuites).toBe(1);
    expect(report.summary.totalMetrics).toBe(3);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.errored).toBe(0); // no error because nothreshold has no threshold
  });

  it("toJSON produces valid JSON string", () => {
    const suites: BenchmarkSuite[] = [
      { name: "s1", description: "suite 1", metrics: [{ name: "m1", value: 42, unit: "count" }] },
    ];
    const report = generator.generate(suites);
    const json = generator.toJSON(report);
    const parsed = JSON.parse(json);
    expect(parsed.suites).toHaveLength(1);
    expect(parsed.suites[0].metrics[0].value).toBe(42);
  });

  it("toMarkdown produces table with headers and data", () => {
    const suites: BenchmarkSuite[] = [
      {
        name: "test", description: "a test",
        metrics: [
          { name: "m1", value: 1, unit: "count", threshold: { operator: "gte", value: 1 }, passed: true },
        ],
      },
    ];
    const report = generator.generate(suites);
    const md = generator.toMarkdown(report);

    expect(md).toContain("# Benchmark Report");
    expect(md).toContain("## test");
    expect(md).toContain("a test");
    expect(md).toContain("| Metric | Value | Unit | Threshold | Status |");
    expect(md).toContain("| m1 | 1 | count | gte 1 | ✅ |");
  });

  it("toMarkdown shows neutral status for non-threshold metrics", () => {
    const suites: BenchmarkSuite[] = [
      {
        name: "neutral", description: "",
        metrics: [{ name: "n1", value: 3, unit: "count" }],
      },
    ];
    const report = generator.generate(suites);
    const md = generator.toMarkdown(report);
    expect(md).toContain("➖");
  });

  it("write creates files in specified directory", async () => {
    const suites: BenchmarkSuite[] = [
      { name: "s1", description: "", metrics: [{ name: "m1", value: 1, unit: "count" }] },
    ];
    const report = generator.generate(suites);
    const tmpDir = process.env.TEMP || "/tmp";
    const outputDir = `${tmpDir}/benchmark-test-${Date.now()}`;
    const paths = await generator.write(report, outputDir);

    const fs = await import("node:fs/promises");
    const jsonContent = await fs.readFile(paths.jsonPath, "utf-8");
    const mdContent = await fs.readFile(paths.mdPath, "utf-8");

    expect(JSON.parse(jsonContent).suites).toHaveLength(1);
    expect(mdContent).toContain("# Benchmark Report");

    await fs.rm(outputDir, { recursive: true, force: true });
  });
});
