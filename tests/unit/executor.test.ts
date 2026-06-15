import { describe, it, expect } from "vitest";
import type { PlanStepRecord } from "@arelyos/engine/types.js";
import type { Tool } from "@arelyos/engine/tools/base-tool.js";
import { CancelledError } from "@arelyos/engine/tools/errors.js";
import { executePlanStep } from "@arelyos/engine/planner/executor.js";

function makeStep(overrides: Partial<PlanStepRecord> = {}): PlanStepRecord {
  return {
    id: "step-1",
    planId: "plan-1",
    description: "Test step",
    tool: "websearch",
    args: '{"query":"test"}',
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

function successTool(): Tool {
  return {
    name: "websearch",
    description: "Mock websearch",
    async execute(args, _ctx) {
      return { content: `result for ${JSON.stringify(args)}` };
    },
  };
}

function failingTool(): Tool {
  return {
    name: "websearch",
    description: "Mock websearch",
    async execute() {
      throw new Error("tool error");
    },
  };
}

function cancelledTool(): Tool {
  return {
    name: "websearch",
    description: "Mock websearch",
    async execute() {
      throw new CancelledError();
    },
  };
}

describe("executePlanStep", () => {
  it("completes when tool exists and executes successfully", async () => {
    const step = makeStep();
    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.result).toContain("test");
    }
  });

  it("fails when tool does not exist in registry", async () => {
    const step = makeStep({ tool: "nonexistent" });
    const tools = new Map<string, Tool>();
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("Unknown tool");
    }
  });

  it("handles invalid args without crashing", async () => {
    const step = makeStep({ args: "not-valid-json" });
    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("completed");
  });

  it("fails when tool throws an exception", async () => {
    const step = makeStep();
    const tools = new Map<string, Tool>([["websearch", failingTool()]]);
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("tool error");
    }
  });

  it("completes immediately when step has no tool", async () => {
    const step = makeStep({ tool: null, args: null });
    const tools = new Map<string, Tool>();
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.result).toBe("Test step");
      expect(result.durationMs).toBe(0);
    }
  });

  it("fails with cancellation message when tool throws CancelledError", async () => {
    const step = makeStep();
    const tools = new Map<string, Tool>([["websearch", cancelledTool()]]);
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("Step was cancelled");
    }
  });

  it("records durationMs for completed steps", async () => {
    const step = makeStep();
    const tools = new Map<string, Tool>([["websearch", successTool()]]);
    const result = await executePlanStep(step, tools, { sessionId: "s1" });

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
