import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { decisionService } from "../../packages/engine/src/llm/decision-service.js";
import { setMemory } from "../../packages/engine/src/persistence/memory-store.js";
import { getDecision } from "../../packages/engine/src/persistence/decision-store.js";
import { createSession } from "../../packages/engine/src/persistence/session-store.js";

describe("Decision lifecycle (integration)", () => {
  let sessionId: string;
  let sessionId2: string;

  beforeEach(() => {
    initTestDb();
    const s1 = createSession({ query: "decision-lifecycle", model: "test", toolMode: "native" });
    sessionId = s1.id;
    const s2 = createSession({ query: "other-session", model: "test", toolMode: "native" });
    sessionId2 = s2.id;
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should log decision with autofilled epoch and memories", async () => {
    await setMemory("mem1", sessionId, "user_preference", "theme", "dark mode", 100, "explicit", []);
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "evolution",
      decision: "apply_structural_evolution",
      rationale: "Pattern success rate exceeded threshold",
    });
    expect(record.sessionId).toBe(sessionId);
    expect(record.decisionType).toBe("evolution");
    expect(record.decision).toBe("apply_structural_evolution");
    expect(record.memoriesUsed).toContain("mem1");
    expect(record.memorySnapshot.length).toBeGreaterThan(0);
    expect(record.outcome).toBe("pending");
  });

  it("should update outcome and detail", async () => {
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "tooling",
      decision: "tool_execution_strategy",
      rationale: "Selected websearch for query complexity",
    });
    const updated = decisionService.updateOutcome(record.id, "success", "Completed successfully");
    expect(updated).toBe(true);
    const fetched = decisionService.getDecision(record.id)!;
    expect(fetched.outcome).toBe("success");
    expect(fetched.outcomeDetail).toBe("Completed successfully");
  });

  it("should isolate decisions by session", async () => {
    await decisionService.logDecision({
      sessionId,
      decisionType: "evolution",
      decision: "session1_only",
      rationale: "test",
    });
    const sess2Decisions = decisionService.queryDecisions({ sessionId: sessionId2 });
    expect(sess2Decisions.length).toBe(0);
    const sess1Decisions = decisionService.queryDecisions({ sessionId });
    expect(sess1Decisions.length).toBe(1);
  });

  it("should preserve memory snapshot at decision time", async () => {
    await setMemory("mem_orig", sessionId, "project_fact", "db", "SQLite", 100, "explicit", []);
    const record = await decisionService.logDecision({
      sessionId,
      decisionType: "architecture",
      decision: "db_choice",
      rationale: "SQLite best fit for embedded use",
    });
    const snapshotKey = record.memorySnapshot.find((m) => m.key === "db")!;
    expect(snapshotKey).toBeDefined();
    expect(snapshotKey.value).toBe("SQLite");
  });

  it("should complete full create → query → outcome cycle", async () => {
    await decisionService.logDecision({
      sessionId,
      decisionType: "evolution",
      decision: "cycle_test",
      rationale: "Full cycle test",
      outcome: "pending",
    });
    const all = decisionService.queryDecisions({ sessionId });
    expect(all.length).toBe(1);
    decisionService.updateOutcome(all[0].id, "rolled_back", "Decision was reverted");
    const updated = getDecision(all[0].id)!;
    expect(updated.outcome).toBe("rolled_back");
    expect(updated.outcomeDetail).toBe("Decision was reverted");
  });
});
