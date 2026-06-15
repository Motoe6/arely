import { describe, it, expect } from "vitest";
import { BenchmarkRunner } from "@arely/benchmarks/runner.js";
import type { Collector, BenchmarkSuite } from "@arely/benchmarks/types.js";

function dummyCollector(name: string, metrics = 1): Collector {
  const items = Array.from({ length: metrics }, (_, i) => ({
    name: `${name}_metric_${i}`, value: i, unit: "count" as const,
  }));
  return {
    name,
    description: `dummy ${name}`,
    collect() {
      return { name, description: `dummy ${name}`, metrics: items };
    },
  };
}

describe("BenchmarkRunner", () => {
  it("runs all registered collectors", async () => {
    const runner = new BenchmarkRunner();
    runner.register("a", dummyCollector("a", 2));
    runner.register("b", dummyCollector("b", 3));

    const report = await runner.run();
    expect(report.suites).toHaveLength(2);
    expect(report.summary.totalMetrics).toBe(5);
  });

  it("runs a subset by name", async () => {
    const runner = new BenchmarkRunner();
    runner.register("a", dummyCollector("a", 2));
    runner.register("b", dummyCollector("b", 3));

    const report = await runner.run(["a"]);
    expect(report.suites).toHaveLength(1);
    expect(report.suites[0].name).toBe("a");
  });

  it("throws for unknown collector name", async () => {
    const runner = new BenchmarkRunner();
    await expect(runner.run(["nonexistent"])).rejects.toThrow('Collector "nonexistent" not registered');
  });

  it("registerAll adds multiple collectors", async () => {
    const runner = new BenchmarkRunner();
    runner.registerAll([dummyCollector("x", 1), dummyCollector("y", 1)]);
    expect(runner.getRegistered()).toEqual(["x", "y"]);
  });

  it("getRegistered returns empty for fresh runner", () => {
    const runner = new BenchmarkRunner();
    expect(runner.getRegistered()).toEqual([]);
  });

  it("tracks pass/fail/errored in summary based on thresholds", async () => {
    const runner = new BenchmarkRunner();
    runner.register("passing", {
      name: "passing",
      description: "",
      collect() {
        return {
          name: "passing", description: "p",
          metrics: [
            { name: "m1", value: 0.5, unit: "ratio", threshold: { operator: "lt", value: 1.0 }, passed: true },
            { name: "m2", value: 1.5, unit: "ratio", threshold: { operator: "lt", value: 1.0 }, passed: false },
          ],
        };
      },
    });

    const report = await runner.run();
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.totalMetrics).toBe(2);
  });
});
