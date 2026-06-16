const PREFIX = "arely_";

const HISTOGRAM_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];

interface CounterEntry {
  value: number;
}

interface HistogramEntry {
  buckets: Record<string, number>;
  sum: number;
  count: number;
}

interface GaugeEntry {
  value: number;
}

type Labels = Record<string, string>;

function labelKey(name: string, labels: Labels): string {
  const parts = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return `${name}{${parts.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

class Metrics {
  private counters: Map<string, CounterEntry> = new Map();
  private histograms: Map<string, HistogramEntry> = new Map();
  private gauges: Map<string, GaugeEntry> = new Map();

  increment(name: string, labels?: Labels): void {
    const key = labelKey(name, labels ?? {});
    const existing = this.counters.get(key);
    if (existing) {
      existing.value++;
    } else {
      this.counters.set(key, { value: 1 });
    }
  }

  add(name: string, labels: Labels, value: number): void {
    const key = labelKey(name, labels ?? {});
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { value });
    }
  }

  observeDuration(name: string, labels: Labels, durationMs: number): void {
    const key = labelKey(name, labels ?? {});
    let entry = this.histograms.get(key);
    if (!entry) {
      const buckets: Record<string, number> = {};
      for (const b of HISTOGRAM_BUCKETS) {
        buckets[String(b)] = 0;
      }
      entry = { buckets, sum: 0, count: 0 };
      this.histograms.set(key, entry);
    }
    entry.count++;
    entry.sum += durationMs;
    for (const b of HISTOGRAM_BUCKETS) {
      if (durationMs <= b) {
        entry.buckets[String(b)]++;
      }
    }
  }

  setGauge(name: string, labels: Labels, value: number): void {
    const key = labelKey(name, labels ?? {});
    this.gauges.set(key, { value });
  }

  snapshot(): { counters: Record<string, number>; histograms: Record<string, { buckets: Record<string, number>; sum: number; count: number }>; gauges: Record<string, number> } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) {
      counters[k] = v.value;
    }
    const histograms: Record<string, { buckets: Record<string, number>; sum: number; count: number }> = {};
    for (const [k, v] of this.histograms) {
      histograms[k] = { buckets: { ...v.buckets }, sum: v.sum, count: v.count };
    }
    const gauges: Record<string, number> = {};
    for (const [k, v] of this.gauges) {
      gauges[k] = v.value;
    }
    return { counters, histograms, gauges };
  }

  prometheusExport(): string {
    const lines: string[] = [];
    const sortedCounters = [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, entry] of sortedCounters) {
      const name = key.split("{")[0];
      const labelsPart = key.includes("{") ? key.slice(key.indexOf("{")) : "";
      lines.push(`# TYPE ${PREFIX}${name} counter`);
      lines.push(`${PREFIX}${name}${labelsPart} ${entry.value}`);
    }
    const sortedHistograms = [...this.histograms.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, entry] of sortedHistograms) {
      const name = key.split("{")[0];
      const labelsPart = key.includes("{") ? key.slice(key.indexOf("{")) : "";
      lines.push(`# TYPE ${PREFIX}${name} histogram`);
      let cumulative = 0;
      for (const b of HISTOGRAM_BUCKETS) {
        cumulative += entry.buckets[String(b)] ?? 0;
        const le = b === Infinity ? "+Inf" : String(b);
        lines.push(`${PREFIX}${name}_bucket${labelsPart}{le="${le}"} ${cumulative}`);
      }
      lines.push(`${PREFIX}${name}_sum${labelsPart} ${entry.sum}`);
      lines.push(`${PREFIX}${name}_count${labelsPart} ${entry.count}`);
    }
    const sortedGauges = [...this.gauges.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, entry] of sortedGauges) {
      const name = key.split("{")[0];
      const labelsPart = key.includes("{") ? key.slice(key.indexOf("{")) : "";
      lines.push(`# TYPE ${PREFIX}${name} gauge`);
      lines.push(`${PREFIX}${name}${labelsPart} ${entry.value}`);
    }
    return lines.join("\n");
  }
}

export const metrics = new Metrics();
