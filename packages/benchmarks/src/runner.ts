import type { Collector, BenchmarkReport, BenchmarkSuite } from "./types.js";
import { ReportGenerator } from "./report-generator.js";

export class BenchmarkRunner {
  private collectors = new Map<string, Collector>();

  register(name: string, collector: Collector): void {
    this.collectors.set(name, collector);
  }

  registerAll(collectors: Collector[]): void {
    for (const c of collectors) {
      this.collectors.set(c.name, c);
    }
  }

  getRegistered(): string[] {
    return [...this.collectors.keys()];
  }

  async run(suiteNames?: string[]): Promise<BenchmarkReport> {
    const names = suiteNames ?? [...this.collectors.keys()];
    const suites: BenchmarkSuite[] = [];

    for (const name of names) {
      const collector = this.collectors.get(name);
      if (!collector) {
        throw new Error(`Collector "${name}" not registered`);
      }
      suites.push(await collector.collect());
    }

    return new ReportGenerator().generate(suites);
  }
}
