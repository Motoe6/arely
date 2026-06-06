import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { createSession } from "../../src/persistence/session-store.js";
import {
  createPlan,
  getPlan,
  updatePlanStatus,
  listPlansBySession,
  createSteps,
  getStepsByPlan,
  markStepRunning,
  markStepCompleted,
  markStepFailed,
  markStepBlocked,
  markStepSkipped,
} from "../../src/persistence/plan-store.js";
import { getDb } from "../../src/persistence/database.js";
import { plans } from "../../src/persistence/schema.js";
import { eq } from "drizzle-orm";

describe("Plan Store", () => {
  let sessionId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "plan test", model: "gpt-4o", toolMode: "native" }).id;
  });

  afterAll(() => cleanupTestDb());

  it("createPlan should insert and return a plan record", () => {
    const plan = createPlan({ sessionId, goal: "test goal" });

    expect(plan.id).toBeTruthy();
    expect(plan.sessionId).toBe(sessionId);
    expect(plan.goal).toBe("test goal");
    expect(plan.status).toBe("pending");
    expect(plan.createdAt).toBeTruthy();
    expect(plan.completedAt).toBeNull();

    const retrieved = getPlan(plan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(plan.id);
    expect(retrieved!.goal).toBe("test goal");
  });

  it("getPlan should return a plan for an existing id", () => {
    const plan = createPlan({ sessionId, goal: "get me" });
    const retrieved = getPlan(plan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(plan.id);
    expect(retrieved!.goal).toBe("get me");
    expect(retrieved!.sessionId).toBe(sessionId);
  });

  it("getPlan should return undefined for missing plan", () => {
    const result = getPlan("nonexistent");
    expect(result).toBeUndefined();
  });

  it("listPlansBySession should return plans for a session", () => {
    createPlan({ sessionId, goal: "goal 1" });
    createPlan({ sessionId, goal: "goal 2" });

    const results = listPlansBySession(sessionId);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((p) => p.sessionId === sessionId)).toBe(true);
  });

  it("updatePlanStatus should transition status and set completedAt on terminal", () => {
    const plan = createPlan({ sessionId, goal: "status test" });

    updatePlanStatus(plan.id, "executing");
    expect(getPlan(plan.id)!.status).toBe("executing");
    expect(getPlan(plan.id)!.completedAt).toBeNull();

    updatePlanStatus(plan.id, "completed");
    expect(getPlan(plan.id)!.status).toBe("completed");
    expect(getPlan(plan.id)!.completedAt).toBeTruthy();
  });

  it("updatePlanStatus should be idempotent for completedAt", () => {
    const plan = createPlan({ sessionId, goal: "idempotent test" });

    updatePlanStatus(plan.id, "executing");
    updatePlanStatus(plan.id, "completed");
    const firstCompletedAt = getPlan(plan.id)!.completedAt;

    updatePlanStatus(plan.id, "completed");
    const secondCompletedAt = getPlan(plan.id)!.completedAt;

    expect(secondCompletedAt).toBe(firstCompletedAt);
  });
});

describe("Plan Step Store", () => {
  let sessionId: string;
  let planId: string;

  beforeAll(() => {
    initTestDb();
    sessionId = createSession({ query: "step test", model: "gpt-4o", toolMode: "native" }).id;
    planId = createPlan({ sessionId, goal: "step plan" }).id;
  });

  afterAll(() => cleanupTestDb());

  it("createSteps should batch insert and return step records", () => {
    const steps = createSteps([
      { planId, description: "Step A", dependsOn: "[]", order: 0 },
      { planId, description: "Step B", tool: "websearch", args: '{"query":"test"}', dependsOn: "[]", order: 1 },
    ]);

    expect(steps.length).toBe(2);
    expect(steps[0].id).toBeTruthy();
    expect(steps[0].planId).toBe(planId);
    expect(steps[0].description).toBe("Step A");
    expect(steps[0].status).toBe("pending");
    expect(steps[0].completedAt).toBeNull();

    expect(steps[1].tool).toBe("websearch");
    expect(steps[1].args).toBe('{"query":"test"}');
  });

  it("getStepsByPlan should return steps ordered by order", () => {
    createSteps([
      { planId, description: "Z", dependsOn: "[]", order: 3 },
      { planId, description: "A", dependsOn: "[]", order: 0 },
      { planId, description: "M", dependsOn: "[]", order: 1 },
    ]);

    const results = getStepsByPlan(planId);
    const descs = results.map((s) => s.description);

    expect(descs.indexOf("A")).toBeLessThan(descs.indexOf("M"));
    expect(descs.indexOf("M")).toBeLessThan(descs.indexOf("Z"));
  });

  it("markStepRunning should set status to running", () => {
    const step = createSteps([{ planId, description: "run test", dependsOn: "[]", order: 10 }])[0];

    markStepRunning(step.id);

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("running");
  });

  it("markStepCompleted should set status, result, and completedAt", () => {
    const step = createSteps([{ planId, description: "complete test", dependsOn: "[]", order: 11 }])[0];

    markStepCompleted(step.id, "success result");

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.result).toBe("success result");
    expect(updated!.completedAt).toBeTruthy();
  });

  it("markStepFailed should set status, error, and completedAt", () => {
    const step = createSteps([{ planId, description: "fail test", dependsOn: "[]", order: 12 }])[0];

    markStepFailed(step.id, "something went wrong");

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("something went wrong");
    expect(updated!.completedAt).toBeTruthy();
  });

  it("markStepBlocked should set status and completedAt", () => {
    const step = createSteps([{ planId, description: "block test", dependsOn: "[]", order: 13 }])[0];

    markStepBlocked(step.id);

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("blocked");
    expect(updated!.completedAt).toBeTruthy();
  });

  it("markStepSkipped should set status and completedAt", () => {
    const step = createSteps([{ planId, description: "skip test", dependsOn: "[]", order: 14 }])[0];

    markStepSkipped(step.id);

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("skipped");
    expect(updated!.completedAt).toBeTruthy();
  });

  it("cascade delete should remove steps when plan is deleted", () => {
    const tmpPlan = createPlan({ sessionId, goal: "cascade test" });
    createSteps([
      { planId: tmpPlan.id, description: "Cascade A", dependsOn: "[]", order: 0 },
      { planId: tmpPlan.id, description: "Cascade B", dependsOn: "[]", order: 1 },
    ]);

    expect(getStepsByPlan(tmpPlan.id).length).toBeGreaterThan(0);

    getDb().delete(plans).where(eq(plans.id, tmpPlan.id)).run();

    expect(getPlan(tmpPlan.id)).toBeUndefined();
    expect(getStepsByPlan(tmpPlan.id).length).toBe(0);
  });

  it("terminal states should be immutable", () => {
    const step = createSteps([{ planId, description: "immutable test", dependsOn: "[]", order: 15 }])[0];

    markStepCompleted(step.id, "done");

    markStepRunning(step.id);
    markStepFailed(step.id, "should not apply");
    markStepBlocked(step.id);
    markStepSkipped(step.id);

    const updated = getStepsByPlan(planId).find((s) => s.id === step.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.result).toBe("done");
  });
});
