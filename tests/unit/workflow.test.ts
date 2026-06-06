import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanRecord, PlanStepRecord } from "@opencode/engine/types.js";
import type { Tool } from "@opencode/engine/tools/base-tool.js";
import type { AgentEvent } from "@opencode/engine/types/events.js";

vi.mock("@opencode/engine/config/index.js", () => ({
  getConfig: () => ({ PLAN_PARALLELISM: 3 }),
}));

import { WorkflowExecutor, buildGraph, computeLevels, safeParseDepends } from "@opencode/engine/planner/workflow.js";

function makeStep(id: string, overrides: Partial<PlanStepRecord> = {}): PlanStepRecord {
  return {
    id,
    planId: "plan-1",
    description: `Step ${id}`,
    tool: null,
    args: null,
    dependsOn: "[]",
    status: "pending",
    result: null,
    error: null,
    order: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function successTool(name = "websearch"): Tool {
  return {
    name,
    description: `Mock ${name}`,
    async execute() {
      return { content: `${name} result` };
    },
  };
}

function failingTool(name = "websearch"): Tool {
  return {
    name,
    description: `Mock ${name}`,
    async execute() {
      throw new Error(`${name} error`);
    },
  };
}

function makePlan(steps: PlanStepRecord[]): PlanRecord & { steps: PlanStepRecord[] } {
  return {
    id: "plan-1",
    sessionId: "session-1",
    agentId: null,
    goal: "test goal",
    status: "pending",
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: null,
    steps,
  };
}

const noopEmit = () => {};

describe("buildGraph", () => {
  it("builds a graph from steps with dependencies", () => {
    const steps = [
      makeStep("A", { dependsOn: "[]", order: 0 }),
      makeStep("B", { dependsOn: '["A"]', order: 1 }),
      makeStep("C", { dependsOn: '["A"]', order: 2 }),
    ];

    const graph = buildGraph(steps);

    expect(graph.size).toBe(3);
    expect(graph.get("A")!.dependents).toEqual(["B", "C"]);
    expect(graph.get("A")!.unresolvedDeps).toBe(0);
    expect(graph.get("B")!.dependsOn).toEqual(["A"]);
    expect(graph.get("B")!.unresolvedDeps).toBe(1);
    expect(graph.get("C")!.unresolvedDeps).toBe(1);
  });

  it("ignores missing dependencies", () => {
    const steps = [
      makeStep("A", { dependsOn: '["X"]', order: 0 }),
    ];

    const graph = buildGraph(steps);

    expect(graph.get("A")!.dependsOn).toEqual(["X"]);
    expect(graph.get("A")!.unresolvedDeps).toBe(0);
  });
});

describe("computeLevels", () => {
  it("levels a linear DAG", () => {
    const steps = [
      makeStep("A", { dependsOn: "[]", order: 0 }),
      makeStep("B", { dependsOn: '["A"]', order: 1 }),
      makeStep("C", { dependsOn: '["B"]', order: 2 }),
    ];

    const graph = buildGraph(steps);
    const levels = computeLevels(graph);

    expect(levels.length).toBe(3);
    expect(levels[0].map((n) => n.step.id)).toEqual(["A"]);
    expect(levels[1].map((n) => n.step.id)).toEqual(["B"]);
    expect(levels[2].map((n) => n.step.id)).toEqual(["C"]);
  });

  it("groups independent steps into the same level", () => {
    const steps = [
      makeStep("A", { dependsOn: "[]", order: 0 }),
      makeStep("B", { dependsOn: "[]", order: 1 }),
      makeStep("C", { dependsOn: '["A","B"]', order: 2 }),
    ];

    const graph = buildGraph(steps);
    const levels = computeLevels(graph);

    expect(levels.length).toBe(2);
    expect(levels[0].map((n) => n.step.id)).toEqual(["A", "B"]);
    expect(levels[1].map((n) => n.step.id)).toEqual(["C"]);
  });

  it("throws on cyclic DAG", () => {
    const steps = [
      makeStep("A", { dependsOn: '["B"]', order: 0 }),
      makeStep("B", { dependsOn: '["A"]', order: 1 }),
    ];

    const graph = buildGraph(steps);
    expect(() => computeLevels(graph)).toThrow("Cyclic or unresolved DAG");
  });
});

describe("WorkflowExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a linear DAG with all successes", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", successTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"test"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"test"}', dependsOn: '["A"]', order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"test"}', dependsOn: '["B"]', order: 2 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.completedSteps).toBe(3);
    expect(result.failedSteps).toBe(0);
    expect(result.results.filter((r) => r.status === "completed").length).toBe(3);
  });

  it("executes parallel levels", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", successTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"b"}', dependsOn: "[]", order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["A","B"]', order: 2 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.completedSteps).toBe(3);
  });

  it("auto-completes steps without a tool", async () => {
    const steps = [
      makeStep("A", { description: "reasoning step", dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"test"}', dependsOn: '["A"]', order: 1 }),
    ];
    const plan = makePlan(steps);
    const tools = new Map<string, Tool>([["websearch", successTool()]]);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.completedSteps).toBe(2);
    const stepA = result.results.find((r) => r.stepId === "A")!;
    expect(stepA.status).toBe("completed");
  });

  it("ignores missing dependencies", async () => {
    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"b"}', dependsOn: '["X"]', order: 1 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.completedSteps).toBe(2);
  });

  it("propagates blocked status when a step fails", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", successTool()],
      ["webfetch", failingTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "webfetch", args: '{"url":"http://x.com"}', dependsOn: "[]", order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["A","B"]', order: 2 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("failed");
    expect(result.completedSteps).toBe(1);
    expect(result.failedSteps).toBe(1);
    const stepC = result.results.find((r) => r.stepId === "C")!;
    expect(stepC.status).toBe("blocked");
  });

  it("transitively propagates blocked status", async () => {
    const tools = new Map<string, Tool>([["websearch", failingTool()]]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"b"}', dependsOn: '["A"]', order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["B"]', order: 2 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("failed");
    expect(result.results.find((r) => r.stepId === "A")!.status).toBe("failed");
    expect(result.results.find((r) => r.stepId === "B")!.status).toBe("blocked");
    expect(result.results.find((r) => r.stepId === "C")!.status).toBe("blocked");
  });

  it("continues execution after partial level failure", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", successTool()],
      ["webfetch", failingTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "webfetch", args: '{"url":"http://x.com"}', dependsOn: "[]", order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["B"]', order: 2 }),
      makeStep("D", { tool: "websearch", args: '{"query":"d"}', dependsOn: "[]", order: 3 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("failed");
    expect(result.completedSteps).toBe(2);
    expect(result.failedSteps).toBe(1);
    const stepC = result.results.find((r) => r.stepId === "C")!;
    expect(stepC.status).toBe("blocked");
    const stepD = result.results.find((r) => r.stepId === "D")!;
    expect(stepD.status).toBe("completed");
  });

  it("fails workflow on full level failure and marks remaining as blocked", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", failingTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"b"}', dependsOn: "[]", order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["A","B"]', order: 2 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("failed");
    expect(result.failedSteps).toBe(2);
    const stepC = result.results.find((r) => r.stepId === "C")!;
    expect(stepC.status).toBe("blocked");
  });

  it("cancels remaining steps on abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "websearch", args: '{"query":"b"}', dependsOn: "[]", order: 1 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan, controller.signal);

    expect(result.status).toBe("failed");
    expect(result.results.every((r) => r.status === "skipped")).toBe(true);
  });

  it("handles mixed level with blocked and completed steps correctly", async () => {
    const tools = new Map<string, Tool>([
      ["websearch", successTool()],
      ["webfetch", failingTool()],
    ]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
      makeStep("B", { tool: "webfetch", args: '{"url":"http://x.com"}', dependsOn: "[]", order: 1 }),
      makeStep("C", { tool: "websearch", args: '{"query":"c"}', dependsOn: '["A"]', order: 2 }),
      makeStep("D", { tool: "websearch", args: '{"query":"d"}', dependsOn: '["B"]', order: 3 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit: noopEmit });
    const result = await executor.execute(plan);

    expect(result.status).toBe("failed");
    const stepC = result.results.find((r) => r.stepId === "C")!;
    const stepD = result.results.find((r) => r.stepId === "D")!;
    expect(stepC.status).toBe("completed");
    expect(stepD.status).toBe("blocked");
  });

  it("emits events in correct order", async () => {
    const events: string[] = [];
    const emit = (event: AgentEvent) => { events.push(event.type); };

    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const steps = [
      makeStep("A", { tool: "websearch", args: '{"query":"a"}', dependsOn: "[]", order: 0 }),
    ];
    const plan = makePlan(steps);

    const executor = new WorkflowExecutor({ tools, emit });
    await executor.execute(plan);

    expect(events).toContain("plan_step_started");
    expect(events).toContain("plan_step_completed");
    expect(events).toContain("workflow_completed");
    expect(events.indexOf("plan_step_started")).toBeLessThan(events.indexOf("plan_step_completed"));
  });
});
