import { describe, it, expect } from "vitest";
import { generateRemediations } from "@arely/engine/agents/remediation.js";
import type { ReliabilityInsight } from "@arely/engine/agents/pipeline-insights.js";
import type { Alert } from "@arely/engine/agents/alert-rules.js";

const baseInsight = (overrides: Partial<ReliabilityInsight> = {}): ReliabilityInsight => ({
  id: "test::tool::t1::warning",
  severity: "warning",
  category: "success_rate",
  targetType: "tool",
  targetId: "t1",
  message: "test message",
  metric: 0.85,
  threshold: 0.9,
  recommendation: "monitor reliability",
  ...overrides,
});

const baseAlert = (overrides: Partial<Alert> = {}): Alert => ({
  ruleId: "test_rule",
  severity: "critical",
  category: "score",
  message: "alert message",
  metric: 50,
  threshold: 60,
  target: "overview",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("generateRemediations", () => {
  it("returns empty array for empty inputs", () => {
    const result = generateRemediations([], []);
    expect(result).toEqual([]);
  });

  it("generates high priority action for critical timeout_rate insight", () => {
    const insight = baseInsight({
      id: "timeout_rate::tool::t1::critical",
      severity: "critical",
      category: "timeout_rate",
      metric: 0.5,
      threshold: 0.4,
    });
    const result = generateRemediations([insight], []);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("high");
    expect(result[0].suggestedPolicy).toBe("exponential_jitter");
    expect(result[0].sourceType).toBe("insight");
    expect(result[0].targetType).toBe("tool");
    expect(result[0].targetId).toBe("t1");
  });

  it("generates medium priority for warning success_rate insight", () => {
    const insight = baseInsight({ severity: "warning", targetId: "websearch" });
    const result = generateRemediations([insight], []);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
    expect(result[0].sourceType).toBe("insight");
    expect(result[0].suggestedPolicy).toBeUndefined();
  });

  it("generates low priority for info usage insight", () => {
    const insight = baseInsight({
      id: "usage::tool::rss::info",
      severity: "info",
      category: "usage",
      targetId: "rss",
    });
    const result = generateRemediations([insight], []);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("low");
  });

  it("marks sourceType as alert when alert dominates", () => {
    const insight = baseInsight({ severity: "warning", targetId: "websearch" });
    const alert = baseAlert({
      category: "success_rate",
      severity: "critical",
      target: "websearch",
      message: "critical alert for websearch",
    });
    const result = generateRemediations([insight], [alert]);
    // Both insight and alert share key (tool::websearch::success_rate) → consolidated
    const action = result.find((a) => a.targetId === "websearch" && a.category === "success_rate");
    expect(action).toBeDefined();
    expect(action!.sourceType).toBe("alert");
    expect(action!.priority).toBe("high");
    expect(action!.sourceInsightIds).toContain(insight.id);
  });

  it("generates separate actions for different categories on same target", () => {
    const sr = baseInsight({ id: "success_rate::tool::websearch::critical", severity: "critical", category: "success_rate", targetId: "websearch" });
    const tr = baseInsight({ id: "timeout_rate::tool::websearch::critical", severity: "critical", category: "timeout_rate", targetId: "websearch" });
    const result = generateRemediations([sr, tr], []);
    expect(result).toHaveLength(2);
    const cats = result.map((a) => a.category).sort();
    expect(cats).toEqual(["success_rate", "timeout_rate"]);
  });

  it("generates pipeline-targeted action", () => {
    const insight = baseInsight({
      id: "success_rate::pipeline::p-123::critical",
      severity: "critical",
      category: "success_rate",
      targetType: "pipeline",
      targetId: "p-123",
    });
    const result = generateRemediations([insight], []);
    expect(result).toHaveLength(1);
    expect(result[0].targetType).toBe("pipeline");
    expect(result[0].targetId).toBe("p-123");
  });

  it("generates overview action from score alert", () => {
    const alert = baseAlert({ target: "overview", severity: "critical", category: "score" });
    const result = generateRemediations([], [alert]);
    expect(result).toHaveLength(1);
    expect(result[0].targetType).toBe("overview");
    expect(result[0].targetId).toBe("overview");
    expect(result[0].suggestedPolicy).toBe("comprehensive_review");
  });

  it("consolidates multiple same-target same-category insights into one action", () => {
    const s1 = baseInsight({ id: "to::tool::t1::warning", severity: "warning", category: "timeout_rate", targetId: "t1" });
    const s2 = baseInsight({ id: "to::tool::t1::critical", severity: "critical", category: "timeout_rate", targetId: "t1" });
    const result = generateRemediations([s1, s2], []);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("high"); // critical wins
    expect(result[0].sourceInsightIds).toHaveLength(2);
  });

  it("assigns suggestedPolicy for critical categories", () => {
    const timeoutInsight = baseInsight({ id: "to::tool::t1::critical", severity: "critical", category: "timeout_rate", targetId: "t1" });
    const retryInsight = baseInsight({ id: "rr::tool::t2::critical", severity: "critical", category: "retry_rate", targetId: "t2" });
    const successInsight = baseInsight({ id: "sr::tool::t3::critical", severity: "critical", category: "success_rate", targetId: "t3" });
    const durationInsight = baseInsight({ id: "dr::tool::t4::critical", severity: "critical", category: "duration", targetId: "t4" });
    const result = generateRemediations([timeoutInsight, retryInsight, successInsight, durationInsight], []);
    expect(result.find((a) => a.category === "timeout_rate")!.suggestedPolicy).toBe("exponential_jitter");
    expect(result.find((a) => a.category === "retry_rate")!.suggestedPolicy).toBe("exponential_jitter");
    expect(result.find((a) => a.category === "success_rate")!.suggestedPolicy).toBe("circuit_breaker_candidate");
    expect(result.find((a) => a.category === "duration")!.suggestedPolicy).toBe("timeout_increase");
  });

  it("does not assign suggestedPolicy for non-critical", () => {
    const insight = baseInsight({ severity: "info", category: "duration", targetId: "t1" });
    const result = generateRemediations([insight], []);
    expect(result[0].suggestedPolicy).toBeUndefined();
  });

  it("output shape is correct for all fields", () => {
    const insight = baseInsight({ id: "sr::tool::t1::critical", severity: "critical", category: "success_rate", targetId: "t1" });
    const result = generateRemediations([insight], []);
    const action = result[0];
    expect(action).toHaveProperty("id");
    expect(action).toHaveProperty("priority");
    expect(action).toHaveProperty("title");
    expect(action).toHaveProperty("description");
    expect(action).toHaveProperty("recommendation");
    expect(action).toHaveProperty("targetType");
    expect(action).toHaveProperty("targetId");
    expect(action).toHaveProperty("category");
    expect(action).toHaveProperty("sourceType");
    expect(action).toHaveProperty("sourceInsightIds");
    expect([ "low", "medium", "high" ]).toContain(action.priority);
    expect([ "tool", "pipeline", "overview" ]).toContain(action.targetType);
    expect([ "insight", "alert" ]).toContain(action.sourceType);
  });

  it("generates remediation from alert even when no matching insight exists", () => {
    const alert = baseAlert({ target: "unknown-tool", severity: "critical", category: "success_rate" });
    const result = generateRemediations([], [alert]);
    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("unknown-tool");
    expect(result[0].targetType).toBe("tool"); // fallback
    expect(result[0].sourceType).toBe("alert");
  });
});
