import { describe, it, expect } from "vitest";
import { ImprovementEvaluator } from "@arely/engine/llm/improvement-evaluator.js";
import type { SelfAssessment, Finding } from "@arely/engine/llm/self-assessment-types.js";

describe("ImprovementEvaluator", () => {
  const evaluator = new ImprovementEvaluator();

  const empty: SelfAssessment = { strengths: [], weaknesses: [], recommendations: [], summary: "" };

  it("should return no changes for identical assessments", () => {
    const result = evaluator.evaluate(empty, empty);
    expect(result.deltas).toHaveLength(0);
    expect(result.resolvedWeaknesses).toHaveLength(0);
    expect(result.newWeaknesses).toHaveLength(0);
    expect(result.summary).toBe("No changes detected");
  });

  it("should detect resolved weaknesses", () => {
    const before: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "strategy", label: "bad_strat", metric: 0.2, threshold: 0.5, details: "" }],
      recommendations: [],
      summary: "",
    };
    const after: SelfAssessment = {
      strengths: [{ type: "strength", dimension: "strategy", label: "bad_strat", metric: 0.85, threshold: 0.75, details: "" }],
      weaknesses: [],
      recommendations: [],
      summary: "",
    };

    const result = evaluator.evaluate(before, after);
    expect(result.resolvedWeaknesses).toHaveLength(1);
    expect(result.resolvedWeaknesses[0].label).toBe("bad_strat");
    expect(result.newWeaknesses).toHaveLength(0);
    expect(result.persistentWeaknesses).toHaveLength(0);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].improved).toBe(true);
    expect(result.deltas[0].delta).toBeCloseTo(0.65);
  });

  it("should detect persistent weaknesses", () => {
    const weak: Finding = { type: "weakness", dimension: "model", label: "gpt-4o/coding", metric: 0.3, threshold: 0.5, details: "" };
    const before: SelfAssessment = { strengths: [], weaknesses: [weak], recommendations: [], summary: "" };
    const after: SelfAssessment = { strengths: [], weaknesses: [{ ...weak, metric: 0.35 }], recommendations: [], summary: "" };

    const result = evaluator.evaluate(before, after);
    expect(result.persistentWeaknesses).toHaveLength(1);
    expect(result.resolvedWeaknesses).toHaveLength(0);
    expect(result.newWeaknesses).toHaveLength(0);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].improved).toBe(true);
    expect(result.deltas[0].delta).toBeCloseTo(0.05);
  });

  it("should detect new weaknesses", () => {
    const before: SelfAssessment = { strengths: [], weaknesses: [], recommendations: [], summary: "" };
    const after: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "prediction", label: "coding bias", metric: -0.2, threshold: 0.15, details: "" }],
      recommendations: [],
      summary: "",
    };

    const result = evaluator.evaluate(before, after);
    expect(result.newWeaknesses).toHaveLength(1);
    expect(result.newWeaknesses[0].label).toBe("coding bias");
    expect(result.persistentWeaknesses).toHaveLength(0);
    expect(result.resolvedWeaknesses).toHaveLength(0);
  });

  it("should compute correct delta values", () => {
    const before: SelfAssessment = {
      strengths: [],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "s1", metric: 0.2, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "strategy", label: "s2", metric: 0.5, threshold: 0.5, details: "" },
      ],
      recommendations: [],
      summary: "",
    };
    const after: SelfAssessment = {
      strengths: [{ type: "strength", dimension: "strategy", label: "s1", metric: 0.9, threshold: 0.75, details: "" }],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "s2", metric: 0.45, threshold: 0.5, details: "" },
      ],
      recommendations: [],
      summary: "",
    };

    const result = evaluator.evaluate(before, after);
    expect(result.deltas).toHaveLength(2);
    const s1Delta = result.deltas.find((d) => d.label === "s1");
    const s2Delta = result.deltas.find((d) => d.label === "s2");
    expect(s1Delta!.delta).toBeCloseTo(0.7);
    expect(s2Delta!.delta).toBeCloseTo(-0.05);
    expect(result.totalImproved).toBe(1);
    expect(result.totalDeclined).toBe(1);
  });

  it("should track improved/declined counts", () => {
    const before: SelfAssessment = {
      strengths: [],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "up", metric: 0.2, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "strategy", label: "down", metric: 0.5, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "strategy", label: "flat", metric: 0.3, threshold: 0.5, details: "" },
      ],
      recommendations: [],
      summary: "",
    };
    const after: SelfAssessment = {
      strengths: [],
      weaknesses: [
        { type: "weakness", dimension: "strategy", label: "up", metric: 0.6, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "strategy", label: "down", metric: 0.4, threshold: 0.5, details: "" },
        { type: "weakness", dimension: "strategy", label: "flat", metric: 0.3, threshold: 0.5, details: "" },
      ],
      recommendations: [],
      summary: "",
    };

    const result = evaluator.evaluate(before, after);
    expect(result.totalImproved).toBe(1);
    expect(result.totalDeclined).toBe(1);
  });

  it("should generate a non-empty summary when changes exist", () => {
    const before: SelfAssessment = {
      strengths: [],
      weaknesses: [{ type: "weakness", dimension: "strategy", label: "s1", metric: 0.2, threshold: 0.5, details: "" }],
      recommendations: [],
      summary: "",
    };
    const after: SelfAssessment = {
      strengths: [],
      weaknesses: [],
      recommendations: [],
      summary: "",
    };

    const result = evaluator.evaluate(before, after);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("resolved");
  });
});
