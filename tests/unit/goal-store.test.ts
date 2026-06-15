import { describe, it, expect, beforeEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import {
  createGoal,
  getGoal,
  updateGoal,
  queryGoals,
  countGoals,
  deleteGoal,
} from "../../packages/engine/src/persistence/goal-store.js";

describe("GoalStore", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("should create and get a goal", () => {
    createGoal({
      id: "g1",
      title: "Build ARELY AgentOS",
      description: "Complete the adaptive agent pipeline",
      priority: 10,
    });
    const g = getGoal("g1");
    expect(g).not.toBeNull();
    expect(g!.title).toBe("Build ARELY AgentOS");
    expect(g!.status).toBe("active");
    expect(g!.priority).toBe(10);
    expect(g!.progressPct).toBe(0);
    expect(g!.completedAt).toBeNull();
  });

  it("should return null for missing goal", () => {
    expect(getGoal("nonexistent")).toBeNull();
  });

  it("should query goals by status", () => {
    createGoal({ id: "g1", title: "Goal A", description: "desc" });
    createGoal({ id: "g2", title: "Goal B", description: "desc", status: "completed", progressPct: 100 });
    const active = queryGoals({ status: "active" });
    expect(active.length).toBe(1);
    expect(active[0].id).toBe("g1");
  });

  it("should update a goal", () => {
    createGoal({ id: "g1", title: "Original", description: "desc" });
    updateGoal("g1", { title: "Updated", priority: 5 });
    const g = getGoal("g1");
    expect(g!.title).toBe("Updated");
    expect(g!.priority).toBe(5);
  });

  it("should update goal status lifecycle", () => {
    createGoal({ id: "g1", title: "Lifecycle", description: "desc" });

    updateGoal("g1", { status: "paused" });
    expect(getGoal("g1")!.status).toBe("paused");

    updateGoal("g1", { status: "active" });
    expect(getGoal("g1")!.status).toBe("active");

    const now = new Date().toISOString();
    updateGoal("g1", { status: "completed", completedAt: now, progressPct: 100 });
    const g = getGoal("g1");
    expect(g!.status).toBe("completed");
    expect(g!.completedAt).toBe(now);
    expect(g!.progressPct).toBe(100);
  });

  it("should update progress", () => {
    createGoal({ id: "g1", title: "Progress", description: "desc" });
    updateGoal("g1", { progressPct: 50 });
    expect(getGoal("g1")!.progressPct).toBe(50);

    updateGoal("g1", { progressPct: 100 });
    expect(getGoal("g1")!.progressPct).toBe(100);
  });

  it("should paginate goals", () => {
    for (let i = 0; i < 5; i++) {
      createGoal({ id: `g${i}`, title: `Goal ${i}`, description: "desc", priority: i });
    }
    expect(queryGoals({ limit: 2, offset: 0 }).length).toBe(2);
    expect(queryGoals({ limit: 2, offset: 2 }).length).toBe(2);
  });

  it("should delete a goal", () => {
    createGoal({ id: "g1", title: "Delete me", description: "desc" });
    expect(deleteGoal("g1")).toBe(true);
    expect(getGoal("g1")).toBeNull();
  });

  it("should return false deleting nonexistent goal", () => {
    expect(deleteGoal("nonexistent")).toBe(false);
  });

  it("should count goals by status", () => {
    createGoal({ id: "g1", title: "A", description: "d" });
    createGoal({ id: "g2", title: "B", description: "d", status: "completed", progressPct: 100 });
    createGoal({ id: "g3", title: "C", description: "d", status: "paused" });

    expect(countGoals({})).toBe(3);
    expect(countGoals({ status: "active" })).toBe(1);
    expect(countGoals({ status: "paused" })).toBe(1);
    expect(countGoals({ status: "completed" })).toBe(1);
  });

  it("should support metadata as JSON", () => {
    const meta = { key: "value", nested: { num: 42 } };
    createGoal({ id: "g1", title: "With meta", description: "desc", metadata: meta });
    const g = getGoal("g1");
    expect(g!.metadata).toEqual(meta);
  });

  it("should query ordered by priority desc then created desc", () => {
    createGoal({ id: "g1", title: "Low", description: "d", priority: 1 });
    createGoal({ id: "g2", title: "High", description: "d", priority: 10 });
    createGoal({ id: "g3", title: "Medium", description: "d", priority: 5 });
    const results = queryGoals({});
    expect(results.length).toBe(3);
    expect(results[0].id).toBe("g2"); // priority 10 first
    expect(results[1].id).toBe("g3"); // priority 5 second
    expect(results[2].id).toBe("g1"); // priority 1 last
  });

  it("should update only provided fields", () => {
    createGoal({ id: "g1", title: "Original", description: "desc" });
    updateGoal("g1", { description: "new desc" });
    const g = getGoal("g1");
    expect(g!.title).toBe("Original");
    expect(g!.description).toBe("new desc");
  });
});
