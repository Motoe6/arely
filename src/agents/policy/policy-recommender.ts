import type { PolicyPackStore } from "./policy-pack.js";
import type { PolicyRule, MetricConditions } from "./policy-types.js";

// ---- Port ----

export interface TraceEvent {
  traceId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RecommenderAuditPort {
  listTraces(limit?: number, offset?: number): { traceId: string; createdAt: string; eventCount: number }[];
  countTraces(): number;
  getTrace(traceId: string): TraceEvent[];
}

// ---- Options ----

export interface RecommenderOptions {
  underperformingThreshold?: number;
  thresholdTuningMargin?: number;
  maxTraces?: number;
}

// ---- Recommendation types ----

export type RecommendationType = "dead_rule" | "underperforming_rule" | "threshold_tuning" | "rule_conflict";
export type RecommendationSeverity = "high" | "medium" | "low";

export interface PolicyRecommendation {
  type: RecommendationType;
  severity: RecommendationSeverity;
  packId: string;
  ruleId?: string;
  relatedRuleIds?: string[];
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  suggestedAction: string;
}

// ---- Internal shape of extracted trace data ----

interface TraceData {
  traceId: string;
  metrics: Record<string, number | undefined>;
  matchedRuleIds: string[];
}

// ---- Helpers ----

function conditionsOverlap(a: MetricConditions, b: MetricConditions): boolean {
  const metrics = ["retryRate", "successRate", "deadLetterRate", "notificationDeliveryRate"] as const;
  const sharedMetric = metrics.some((m) => m in a && m in b);
  if (sharedMetric) return true;
  if (a.circuitBreakerState && b.circuitBreakerState) {
    return a.circuitBreakerState === b.circuitBreakerState;
  }
  return false;
}

function extractRuleIds(payload: Record<string, unknown>): string[] {
  const actions = payload.actions;
  if (!Array.isArray(actions)) return [];
  return actions.map((a: unknown) => {
    if (a && typeof a === "object" && "ruleId" in a) return (a as { ruleId: string }).ruleId;
    return undefined;
  }).filter(Boolean) as string[];
}

function extractMetrics(payload: Record<string, unknown>): Record<string, number | undefined> {
  const m = payload.metrics;
  if (!m || typeof m !== "object") return {};
  return m as Record<string, number | undefined>;
}

// ---- Recommender ----

export class PolicyRecommender {
  private threshold: number;
  private tuningMargin: number;
  private maxTraces: number;

  constructor(
    private packStore: PolicyPackStore,
    private auditPort: RecommenderAuditPort,
    options: RecommenderOptions = {},
  ) {
    this.threshold = options.underperformingThreshold ?? 0.05;
    this.tuningMargin = options.thresholdTuningMargin ?? 0.1;
    this.maxTraces = options.maxTraces ?? 100;
  }

  analyzeAll(): PolicyRecommendation[] {
    const packs = this.packStore.list();
    const traces = this.collectTraces();
    const recs: PolicyRecommendation[] = [];
    for (const pack of packs) {
      recs.push(...this.analyzePackData(pack.id, pack.rules, traces));
    }
    return recs;
  }

  analyzePack(packId: string): PolicyRecommendation[] {
    const pack = this.packStore.get(packId);
    if (!pack) return [];
    const traces = this.collectTraces();
    return this.analyzePackData(pack.id, pack.rules, traces);
  }

  // ---- Private ----

  private collectTraces(): TraceData[] {
    const total = Math.min(this.auditPort.countTraces(), this.maxTraces);
    const out: TraceData[] = [];
    let offset = 0;
    const page = 100;
    while (out.length < total) {
      const summaries = this.auditPort.listTraces(page, offset);
      for (const s of summaries) {
        if (out.length >= total) break;
        const events = this.auditPort.getTrace(s.traceId);
        const cycle = events.find((e) => e.eventType === "cycle_started");
        if (!cycle) continue;
        out.push({
          traceId: s.traceId,
          metrics: extractMetrics(cycle.payload),
          matchedRuleIds: extractRuleIds(cycle.payload),
        });
      }
      offset += page;
    }
    return out;
  }

  private analyzePackData(packId: string, rules: PolicyRule[], traces: TraceData[]): PolicyRecommendation[] {
    const recs: PolicyRecommendation[] = [];
    recs.push(...this.findDeadRules(packId, rules, traces));
    recs.push(...this.findUnderperformingRules(packId, rules, traces));
    recs.push(...this.findThresholdTuning(packId, rules, traces));
    recs.push(...this.findRuleConflicts(packId, rules));
    return recs;
  }

  private findDeadRules(packId: string, rules: PolicyRule[], traces: TraceData[]): PolicyRecommendation[] {
    if (traces.length === 0) return [];
    const matched = new Set(traces.flatMap((t) => t.matchedRuleIds));
    const recs: PolicyRecommendation[] = [];
    for (const rule of rules) {
      if (!matched.has(rule.id)) {
        recs.push({
          type: "dead_rule",
          severity: "medium",
          packId,
          ruleId: rule.id,
          title: `Rule "${rule.id}" never matched any trace`,
          description: `This rule has not triggered in any of the ${traces.length} traces analyzed. It may be dead or its conditions may be too restrictive.`,
          evidence: { tracesAnalyzed: traces.length, matchedCount: 0 },
          suggestedAction: `Review or remove rule "${rule.id}" to reduce policy complexity.`,
        });
      }
    }
    return recs;
  }

  private findUnderperformingRules(packId: string, rules: PolicyRule[], traces: TraceData[]): PolicyRecommendation[] {
    if (traces.length === 0) return [];
    const matched = traces.flatMap((t) => t.matchedRuleIds);
    const total = traces.length;
    const recs: PolicyRecommendation[] = [];
    for (const rule of rules) {
      const count = matched.filter((id) => id === rule.id).length;
      if (count > 0 && count / total < this.threshold) {
        recs.push({
          type: "underperforming_rule",
          severity: "low",
          packId,
          ruleId: rule.id,
          title: `Rule "${rule.id}" has a low match rate`,
          description: `This rule matched only ${count}/${total} traces (${(count / total * 100).toFixed(1)}%), below the ${(this.threshold * 100).toFixed(0)}% threshold.`,
          evidence: { tracesAnalyzed: total, matchedCount: count, matchRate: count / total },
          suggestedAction: `Loosen conditions for rule "${rule.id}" or remove it if no longer needed.`,
        });
      }
    }
    return recs;
  }

  private findThresholdTuning(packId: string, rules: PolicyRule[], traces: TraceData[]): PolicyRecommendation[] {
    if (traces.length < 3) return [];
    const recs: PolicyRecommendation[] = [];

    for (const rule of rules) {
      const when = rule.when;
      for (const [metric, threshold] of Object.entries(when)) {
        if (metric === "circuitBreakerState") continue;
        if (!threshold || typeof threshold !== "object") continue;
        const th = threshold as { gt?: number; lt?: number };

        const values = traces
          .map((t) => t.metrics[metric])
          .filter((v): v is number => v !== undefined);

        if (values.length < 3) continue;

        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);

        if (th.lt !== undefined && max >= th.lt * (1 - this.tuningMargin) && max < th.lt) {
          recs.push({
            type: "threshold_tuning",
            severity: "low",
            packId,
            ruleId: rule.id,
            title: `Threshold "${metric} < ${th.lt}" in rule "${rule.id}" is near observed values`,
            description: `The maximum observed ${metric} is ${max.toFixed(4)}, approaching the lt threshold of ${th.lt}. Average: ${avg.toFixed(4)}. Consider tightening if false positives occur.`,
            evidence: { metric, thresholdLt: th.lt, observedMin: min, observedMax: max, observedAvg: avg, sampleCount: values.length },
            suggestedAction: `Consider lowering "${metric}" lt threshold to ${Math.min(th.lt, max * 1.2).toFixed(4)} to reduce false positives.`,
          });
        }

        if (th.gt !== undefined && min <= th.gt * (1 + this.tuningMargin) && min > th.gt) {
          recs.push({
            type: "threshold_tuning",
            severity: "low",
            packId,
            ruleId: rule.id,
            title: `Threshold "${metric} > ${th.gt}" in rule "${rule.id}" is near observed values`,
            description: `The minimum observed ${metric} is ${min.toFixed(4)}, approaching the gt threshold of ${th.gt}. Average: ${avg.toFixed(4)}. Consider tightening if false positives occur.`,
            evidence: { metric, thresholdGt: th.gt, observedMin: min, observedMax: max, observedAvg: avg, sampleCount: values.length },
            suggestedAction: `Consider raising "${metric}" gt threshold to ${Math.max(th.gt, min * 0.8).toFixed(4)} to reduce false positives.`,
          });
        }
      }
    }
    return recs;
  }

  private findRuleConflicts(packId: string, rules: PolicyRule[]): PolicyRecommendation[] {
    if (rules.length < 2) return [];
    const recs: PolicyRecommendation[] = [];
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];
        if (conditionsOverlap(a.when, b.when)) {
          recs.push({
            type: "rule_conflict",
            severity: "high",
            packId,
            ruleId: a.id,
            relatedRuleIds: [b.id],
            title: `Potential conflict between rules "${a.id}" and "${b.id}"`,
            description: `Both rules in pack "${packId}" have overlapping conditions. A single input could match both, but only the first matched rule's action fires.`,
            evidence: { ruleA: a.id, ruleB: b.id, conditionsA: a.when, conditionsB: b.when },
            suggestedAction: `Review rules "${a.id}" and "${b.id}" in pack "${packId}" and either merge them or add mutually-exclusive conditions.`,
          });
        }
      }
    }
    return recs;
  }
}
