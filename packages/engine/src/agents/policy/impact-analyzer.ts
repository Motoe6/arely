import type { PolicyPackStore } from "./policy-pack.js";
import type { PolicyRule, MetricConditions } from "./policy-types.js";
import type { PolicyRecommendation, RecommendationType } from "./policy-recommender.js";
import { SimulationEngine } from "../simulation/simulation-engine.js";

export interface ImpactReport {
  recommendationType: RecommendationType;
  packId: string;
  ruleId?: string;
  impactScore: number;
  confidence: "high" | "medium" | "low";
  tracesRequested: number;
  tracesSucceeded: number;
  tracesFailed: number;
  originalTotalActions: number;
  simulatedTotalActions: number;
  actionDelta: number;
  originalMatchRate: number;
  simulatedMatchRate: number;
  matchRateDelta: number;
  addedRules: string[];
  removedRules: string[];
  warnings: string[];
}

export interface ValidateOptions {
  maxTraces?: number;
  relaxFactor?: number;
}

interface TraceIdLister {
  listTraces(limit?: number, offset?: number): { traceId: string }[];
}

export class ImpactAnalyzer {
  private maxTraces: number;
  private relaxFactor: number;
  private tuningMargin: number;

  constructor(
    private packStore: PolicyPackStore,
    private simulationEngine: SimulationEngine,
    private traceLister: TraceIdLister,
    options: ValidateOptions = {},
  ) {
    this.maxTraces = options.maxTraces ?? 100;
    this.relaxFactor = options.relaxFactor ?? 0.25;
    this.tuningMargin = 0.1;
  }

  validate(recommendation: PolicyRecommendation, traceIds?: string[]): ImpactReport {
    const pack = this.packStore.get(recommendation.packId);
    if (!pack) {
      return this.emptyReport(recommendation, `Pack "${recommendation.packId}" not found`);
    }

    const ids = traceIds ?? this.getDefaultTraceIds();
    if (ids.length === 0) {
      return this.emptyReport(recommendation, "No traces available for simulation");
    }

    const originalRules = pack.rules;
    const modifiedRules = this.buildModifiedRules(recommendation, originalRules);

    const originalBatch = this.simulationEngine.simulateBatch(ids, originalRules);
    const modifiedBatch = modifiedRules
      ? this.simulationEngine.simulateBatch(ids, modifiedRules)
      : originalBatch;

    const originalTotal = originalBatch.results.reduce((s, r) => s + r.simulatedActions.length, 0);
    const simulatedTotal = modifiedBatch.results.reduce((s, r) => s + r.simulatedActions.length, 0);
    const originalMatchRate = originalBatch.overallMatchRate;
    const simulatedMatchRate = modifiedBatch.overallMatchRate;
    const matchRateDelta = simulatedMatchRate - originalMatchRate;

    const originalSimRuleIds = new Set(originalBatch.results.flatMap((r) => r.simulatedActions.map((a) => a.ruleId)));
    const modifiedSimRuleIds = new Set(modifiedBatch.results.flatMap((r) => r.simulatedActions.map((a) => a.ruleId)));

    const allAdded = [...modifiedSimRuleIds].filter((id) => !originalSimRuleIds.has(id));
    const allRemoved = [...originalSimRuleIds].filter((id) => !modifiedSimRuleIds.has(id));

    const actionDelta = simulatedTotal - originalTotal;
    const impactScore = Math.min(1, Math.abs(matchRateDelta));
    const tracesSucceeded = originalBatch.tracesSucceeded;
    const tracesFailed = originalBatch.tracesFailed;

    const warnings: string[] = [];
    if (recommendation.type === "rule_conflict") {
      warnings.push("Conflict recommendation requires manual rule selection. Simulated with ruleId from recommendation as the removed rule.");
    }

    let confidence: "high" | "medium" | "low";
    if (tracesSucceeded >= 100) confidence = "high";
    else if (tracesSucceeded >= 25) confidence = "medium";
    else confidence = "low";

    if (tracesSucceeded < 100 && Math.abs(matchRateDelta) > 0.5) {
      confidence = confidence === "high" ? "medium" : "low";
    }

    return {
      recommendationType: recommendation.type,
      packId: recommendation.packId,
      ruleId: recommendation.ruleId,
      impactScore,
      confidence,
      tracesRequested: ids.length,
      tracesSucceeded,
      tracesFailed,
      originalTotalActions: originalTotal,
      simulatedTotalActions: simulatedTotal,
      actionDelta,
      originalMatchRate,
      simulatedMatchRate,
      matchRateDelta,
      addedRules: allAdded,
      removedRules: allRemoved,
      warnings,
    };
  }

  validateAll(recommendations: PolicyRecommendation[]): ImpactReport[] {
    return recommendations.map((r) => this.validate(r));
  }

  private getDefaultTraceIds(): string[] {
    const summaries = this.traceLister.listTraces(this.maxTraces, 0);
    return summaries.map((s) => s.traceId);
  }

  private buildModifiedRules(recommendation: PolicyRecommendation, rules: PolicyRule[]): PolicyRule[] | undefined {
    switch (recommendation.type) {
      case "dead_rule":
      case "rule_conflict":
        return rules.filter((r) => r.id !== recommendation.ruleId);

      case "underperforming_rule":
        return rules.map((r) => {
          if (r.id !== recommendation.ruleId) return r;
          return { ...r, when: this.relaxConditions(r.when) };
        });

      case "threshold_tuning": {
        const mod = this.buildTunedRules(recommendation, rules);
        if (!mod) return undefined;
        return mod;
      }

      default:
        return undefined;
    }
  }

  private relaxConditions(when: MetricConditions): MetricConditions {
    const out: MetricConditions = {};
    for (const [key, threshold] of Object.entries(when)) {
      if (key === "circuitBreakerState") {
        out.circuitBreakerState = when.circuitBreakerState;
        continue;
      }
      if (!threshold || typeof threshold !== "object") continue;
      const th = threshold as { gt?: number; lt?: number };
      const copy: { gt?: number; lt?: number } = {};
      if (th.gt !== undefined) copy.gt = th.gt * (1 - this.relaxFactor);
      if (th.lt !== undefined) copy.lt = th.lt * (1 + this.relaxFactor);
      (out as Record<string, unknown>)[key] = copy;
    }
    return out;
  }

  private buildTunedRules(recommendation: PolicyRecommendation, rules: PolicyRule[]): PolicyRule[] | undefined {
    const evidence = recommendation.evidence;
    const metric = evidence.metric as string | undefined;
    if (!metric) return undefined;

    const observedMax = evidence.observedMax as number | undefined;
    const observedMin = evidence.observedMin as number | undefined;
    const thresholdLt = evidence.thresholdLt as number | undefined;
    const thresholdGt = evidence.thresholdGt as number | undefined;

    let newValue: number | undefined;

    if (thresholdLt !== undefined && observedMax !== undefined) {
      newValue = Math.min(thresholdLt, observedMax * (1 + this.tuningMargin));
    } else if (thresholdGt !== undefined && observedMin !== undefined) {
      newValue = Math.max(thresholdGt, observedMin * (1 - this.tuningMargin));
    }

    if (newValue === undefined) return undefined;

    return rules.map((r) => {
      if (r.id !== recommendation.ruleId) return r;
      return this.applyValueToMetric(r, metric, newValue, thresholdLt !== undefined ? "lt" : "gt");
    });
  }

  private applyValueToMetric(rule: PolicyRule, metricName: string, value: number, type: "lt" | "gt"): PolicyRule {
    const key = metricName as keyof MetricConditions;
    const current = rule.when[key];
    if (!current || typeof current !== "object") return rule;

    const th = { ...(current as { gt?: number; lt?: number }) };
    if (type === "lt") th.lt = value;
    if (type === "gt") th.gt = value;

    return {
      ...rule,
      when: { ...rule.when, [key]: th },
    };
  }

  private emptyReport(recommendation: PolicyRecommendation, reason: string): ImpactReport {
    return {
      recommendationType: recommendation.type,
      packId: recommendation.packId,
      ruleId: recommendation.ruleId,
      impactScore: 0,
      confidence: "low",
      tracesRequested: 0,
      tracesSucceeded: 0,
      tracesFailed: 0,
      originalTotalActions: 0,
      simulatedTotalActions: 0,
      actionDelta: 0,
      originalMatchRate: 0,
      simulatedMatchRate: 0,
      matchRateDelta: 0,
      addedRules: [],
      removedRules: [],
      warnings: [reason],
    };
  }
}
