import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanRecord, PlanStepRecord } from "@arelyos/engine/types.js";
import type { WorkflowResult } from "@arelyos/engine/planner/workflow.js";

const {
  mockListPlansByStatus,
  mockGetPlan,
  mockGetStepsByPlan,
  mockMarkStepPending,
  mockUpdatePlanStatus,
} = vi.hoisted(() => ({
  mockListPlansByStatus: vi.fn(),
  mockGetPlan: vi.fn(),
  mockGetStepsByPlan: vi.fn(),
  mockMarkStepPending: vi.fn(),
  mockUpdatePlanStatus: vi.fn(),
}));

vi.mock("@arelyos/engine/config/index.js", () => ({
  getConfig: () => ({ PLAN_PARALLELISM: 3 }),
}));

vi.mock("@arelyos/engine/persistence/plan-store.js", () => ({
  listPlansByStatus: mockListPlansByStatus,
  getPlan: mockGetPlan,
  getStepsByPlan: mockGetStepsByPlan,
  markStepPending: mockMarkStepPending,
  updatePlanStatus: mockUpdatePlanStatus,
}));

import { recoverPlans, resumePlan } from "@arelyos/engine/planner/recovery.js";

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: "plan_1",
    sessionId: "s1",
    agentId: null,
    goal: "test goal",
    status: "executing",
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function makeStep(overrides: Partial<PlanStepRecord> = {}): PlanStepRecord {
  return {
    id: "step_0",
    planId: "plan_1",
    description: "Search",
    tool: "websearch",
    args: "{}",
    dependsOn: "[]",
    status: "pending",
    result: null,
    error: null,
    order: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("recoverPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns plans with status executing", () => {
    const plan = makePlan();
    mockListPlansByStatus.mockReturnValue([plan]);
    mockGetStepsByPlan.mockReturnValue([]);

    const result = recoverPlans();

    expect(mockListPlansByStatus).toHaveBeenCalledWith("executing");
    expect(result).toEqual([plan]);
  });

  it("normalizes running steps to pending", () => {
    const plan = makePlan();
    const steps = [
      makeStep({ id: "step_0", status: "running" }),
      makeStep({ id: "step_1", status: "completed", result: "data" }),
      makeStep({ id: "step_2", status: "pending" }),
    ];
    mockListPlansByStatus.mockReturnValue([plan]);
    mockGetStepsByPlan.mockReturnValue(steps);

    recoverPlans();

    expect(mockMarkStepPending).toHaveBeenCalledTimes(1);
    expect(mockMarkStepPending).toHaveBeenCalledWith("step_0");
  });

  it("preserves completed steps during normalization", () => {
    const plan = makePlan();
    const steps = [
      makeStep({ id: "step_0", status: "completed", result: "done" }),
    ];
    mockListPlansByStatus.mockReturnValue([plan]);
    mockGetStepsByPlan.mockReturnValue(steps);

    recoverPlans();

    expect(mockMarkStepPending).not.toHaveBeenCalled();
  });

  it("returns empty array when no executing plans exist", () => {
    mockListPlansByStatus.mockReturnValue([]);

    const result = recoverPlans();

    expect(result).toEqual([]);
    expect(mockGetStepsByPlan).not.toHaveBeenCalled();
  });
});

describe("resumePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if plan is not found", async () => {
    mockGetPlan.mockReturnValue(undefined);

    const executor = { execute: vi.fn() } as never;
    await expect(resumePlan("nonexistent", executor)).rejects.toThrow("Plan not found");
  });

  it("loads plan and steps and delegates to executor", async () => {
    const plan = makePlan();
    const steps = [makeStep({ id: "step_0", status: "pending" })];
    mockGetPlan.mockReturnValue(plan);
    mockGetStepsByPlan.mockReturnValue(steps);

    const mockResult: WorkflowResult = {
      planId: "plan_1",
      status: "completed",
      completedSteps: 1,
      failedSteps: 0,
      executionTimeMs: 50,
      results: [{ stepId: "step_0", status: "completed", result: "data", durationMs: 50 }],
    };
    const executor = { execute: vi.fn().mockResolvedValue(mockResult) };

    const result = await resumePlan("plan_1", executor as never);

    expect(mockGetPlan).toHaveBeenCalledWith("plan_1");
    expect(mockGetStepsByPlan).toHaveBeenCalledWith("plan_1");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);
  });

  it("normalizes running steps before executing", async () => {
    const plan = makePlan();
    const steps = [
      makeStep({ id: "step_0", status: "completed", result: "data" }),
      makeStep({ id: "step_1", status: "running" }),
    ];
    mockGetPlan.mockReturnValue(plan);
    mockGetStepsByPlan.mockReturnValue(steps);

    const executor = {
      execute: vi.fn().mockResolvedValue({
        planId: "plan_1",
        status: "completed",
        completedSteps: 1,
        failedSteps: 0,
        executionTimeMs: 50,
        results: [] as never[],
      }),
    };

    await resumePlan("plan_1", executor as never);

    expect(mockMarkStepPending).toHaveBeenCalledWith("step_1");
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "plan_1",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "step_0", status: "completed" }),
          expect.objectContaining({ id: "step_1", status: "pending" }),
        ]),
      }),
      undefined,
    );
  });

  it("updates plan status to executing", async () => {
    const plan = makePlan();
    mockGetPlan.mockReturnValue(plan);
    mockGetStepsByPlan.mockReturnValue([]);

    const executor = {
      execute: vi.fn().mockResolvedValue({
        planId: "plan_1",
        status: "completed",
        completedSteps: 0,
        failedSteps: 0,
        executionTimeMs: 0,
        results: [] as never[],
      }),
    };

    await resumePlan("plan_1", executor as never);

    expect(mockUpdatePlanStatus).toHaveBeenCalledWith("plan_1", "executing");
  });
});

describe("WorkflowExecutor resume (pre-existing terminal states)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips completed steps and only executes pending ones", async () => {
    const { WorkflowExecutor } = await import("@arelyos/engine/planner/workflow.js");

    const steps = [
      { id: "step_0", planId: "plan_1", description: "Step A", tool: null, args: null, dependsOn: "[]", status: "completed", result: "already done", error: null, order: 0, createdAt: "", completedAt: null },
      { id: "step_1", planId: "plan_1", description: "Step B", tool: null, args: null, dependsOn: '["step_0"]', status: "pending", result: null, error: null, order: 1, createdAt: "", completedAt: null },
    ];

    const tools = new Map();
    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const result = await executor.execute({ id: "plan_1", sessionId: "s1", agentId: null, goal: "g", status: "executing", createdAt: "", completedAt: null, steps }, undefined);

    expect(result.completedSteps >= 1).toBe(true);
    expect(result.results.some((r) => r.stepId === "step_0" && r.status === "completed")).toBe(true);
  });

  it("returns immediately if all steps are already terminal", async () => {
    const { WorkflowExecutor } = await import("@arelyos/engine/planner/workflow.js");

    const steps = [
      { id: "step_0", planId: "plan_1", description: "Step A", tool: null, args: null, dependsOn: "[]", status: "completed", result: "done", error: null, order: 0, createdAt: "", completedAt: null },
      { id: "step_1", planId: "plan_1", description: "Step B", tool: null, args: null, dependsOn: "[]", status: "failed", result: null, error: "err", order: 1, createdAt: "", completedAt: null },
    ];

    const tools = new Map();
    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const result = await executor.execute({ id: "plan_1", sessionId: "s1", agentId: null, goal: "g", status: "executing", createdAt: "", completedAt: null, steps }, undefined);

    expect(result.status).toBe("failed");
    expect(result.completedSteps).toBe(1);
    expect(result.failedSteps).toBe(1);
  });

  it("handles partial workflow with mixed states correctly", async () => {
    const { WorkflowExecutor } = await import("@arelyos/engine/planner/workflow.js");

    const steps = [
      { id: "step_0", planId: "plan_1", description: "A", tool: null, args: null, dependsOn: "[]", status: "completed", result: "result A", error: null, order: 0, createdAt: "", completedAt: null },
      { id: "step_1", planId: "plan_1", description: "B", tool: null, args: null, dependsOn: "[]", status: "completed", result: "result B", error: null, order: 1, createdAt: "", completedAt: null },
      { id: "step_2", planId: "plan_1", description: "C", tool: null, args: null, dependsOn: '["step_0","step_1"]', status: "pending", result: null, error: null, order: 2, createdAt: "", completedAt: null },
    ];

    const tools = new Map();
    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const result = await executor.execute({ id: "plan_1", sessionId: "s1", agentId: null, goal: "g", status: "executing", createdAt: "", completedAt: null, steps }, undefined);

    expect(result.completedSteps).toBe(3);
    expect(result.results.filter((r) => r.status === "completed").length).toBe(3);
    expect(result.results.find((r) => r.stepId === "step_2")?.status).toBe("completed");
  });
});
