import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createDecision, getDecision, queryDecisions, updateOutcome, countDecisions } from "../../packages/engine/src/persistence/decision-store.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";

describe("DecisionStore", () => {
  let sessionId: string;

  beforeEach(() => {
    initTestDb();
    const session = createSession({ query: "decision-test", model: "test", toolMode: "native" });
    sessionId = session.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should create and get a decision", () => {
    createDecision({
      id: "dec1",
      sessionId,
      decisionType: "evolution",
      decision: "apply_structural_evolution",
      rationale: "Pattern had >80% success over 20+ samples",
      confidence: 85,
    });
    const rec = getDecision("dec1");
    expect(rec).not.toBeNull();
    expect(rec!.decisionType).toBe("evolution");
    expect(rec!.decision).toBe("apply_structural_evolution");
    expect(rec!.confidence).toBe(85);
    expect(rec!.outcome).toBe("pending");
  });

  it("should return null for missing decision", () => {
    expect(getDecision("nonexistent")).toBeNull();
  });

  it("should query by sessionId", () => {
    createDecision({ id: "d1", sessionId, decisionType: "t", decision: "d1", rationale: "r1" });
    createDecision({ id: "d2", sessionId, decisionType: "t", decision: "d2", rationale: "r2" });
    const results = queryDecisions({ sessionId });
    expect(results.length).toBe(2);
  });

  it("should query by decisionType", () => {
    createDecision({ id: "d1", sessionId, decisionType: "evolution", decision: "d1", rationale: "r1" });
    createDecision({ id: "d2", sessionId, decisionType: "tooling", decision: "d2", rationale: "r2" });
    const results = queryDecisions({ decisionType: "evolution" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("d1");
  });

  it("should query by outcome", () => {
    createDecision({ id: "d1", sessionId, decisionType: "t", decision: "d1", rationale: "r1", outcome: "success" });
    createDecision({ id: "d2", sessionId, decisionType: "t", decision: "d2", rationale: "r2" });
    const results = queryDecisions({ outcome: "success" });
    expect(results.length).toBe(1);
  });

  it("should paginate with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      createDecision({ id: `d${i}`, sessionId, decisionType: "t", decision: `d${i}`, rationale: `r${i}` });
    }
    expect(queryDecisions({ limit: 2, offset: 0 }).length).toBe(2);
    expect(queryDecisions({ limit: 2, offset: 2 }).length).toBe(2);
  });

  it("should update outcome", () => {
    createDecision({ id: "d1", sessionId, decisionType: "t", decision: "d1", rationale: "r1" });
    const updated = updateOutcome("d1", "success", "Completed without errors");
    expect(updated).toBe(true);
    const rec = getDecision("d1");
    expect(rec!.outcome).toBe("success");
    expect(rec!.outcomeDetail).toBe("Completed without errors");
  });

  it("should return false when updating nonexistent outcome", () => {
    expect(updateOutcome("nonexistent", "success")).toBe(false);
  });

  it("should preserve core fields immutable after create", () => {
    createDecision({
      id: "d1",
      sessionId,
      decisionType: "evolution",
      decision: "original_decision",
      rationale: "original rationale",
      confidence: 90,
    });
    const rec = getDecision("d1")!;
    expect(rec.decision).toBe("original_decision");
    expect(rec.rationale).toBe("original rationale");
    expect(rec.confidence).toBe(90);
  });

  it("should parse empty arrays for memoriesUsed and memorySnapshot", () => {
    createDecision({ id: "d1", sessionId, decisionType: "t", decision: "d1", rationale: "r1" });
    const rec = getDecision("d1")!;
    expect(rec.memoriesUsed).toEqual([]);
    expect(rec.memorySnapshot).toEqual([]);
  });

  it("should parse memoriesUsed and memorySnapshot from JSON", () => {
    createDecision({
      id: "d1",
      sessionId,
      decisionType: "t",
      decision: "d1",
      rationale: "r1",
      memoriesUsed: ["mem1", "mem2"],
      memorySnapshot: [{ id: "mem1", type: "user_preference", key: "theme", value: "dark" }],
    });
    const rec = getDecision("d1")!;
    expect(rec.memoriesUsed).toEqual(["mem1", "mem2"]);
    expect(rec.memorySnapshot).toEqual([{ id: "mem1", type: "user_preference", key: "theme", value: "dark" }]);
  });

  it("should count decisions", () => {
    createDecision({ id: "d1", sessionId, decisionType: "evolution", decision: "d1", rationale: "r1" });
    createDecision({ id: "d2", sessionId, decisionType: "tooling", decision: "d2", rationale: "r2" });
    expect(countDecisions({ sessionId })).toBe(2);
    expect(countDecisions({ decisionType: "evolution" })).toBe(1);
    expect(countDecisions({})).toBe(2);
  });
});
