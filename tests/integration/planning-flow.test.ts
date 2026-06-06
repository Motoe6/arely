import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import type { PlanStepRecord } from "@opencode/engine/types.js";
import type { LLMAdapter, LLMResponse } from "@opencode/engine/llm/adapter.js";
import type { Tool } from "@opencode/engine/tools/base-tool.js";

const mockEmit = vi.fn();

vi.mock("@opencode/engine/config/index.js", () => ({
  loadConfig: vi.fn(),
  getConfig: () => ({
    TOOL_TIMEOUT_MS: 5000,
    PERMISSION_TIMEOUT_MS: 5000,
    OPENCODE_PERMIT_WEBSEARCH: "allow",
    OPENCODE_PERMIT_WEBFETCH: "allow",
    CIRCUIT_BREAKER_ENABLED: false,
    RETRY_ENABLED: false,
    RATE_LIMIT_ENABLED: false,
    PLAN_MAX_STEPS: 10,
    PLAN_PARALLELISM: 3,
    OPENCODE_MAX_ITERATIONS: 10,
    OPENCODE_STREAMING: true,
    OPENCODE_TOOL_MODE: "native",
  }),
}));

beforeEach(() => {
  initTestDb();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanupTestDb();
});

function stepLLM(responses: LLMResponse[][]): LLMAdapter {
  let callIndex = 0;
  return {
    complete() {
      const batch = responses[callIndex] ?? [];
      callIndex++;
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next() {
              if (i < batch.length) return Promise.resolve({ value: batch[i++], done: false });
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
  };
}

function successTool(name: string): Tool {
  return { name, description: `Mock ${name}`, async execute() { return { content: `${name} result data` }; } };
}

function failingTool(name: string): Tool {
  return { name, description: `Mock ${name}`, async execute() { throw new Error(`${name} failed`); } };
}

function makePlan(steps: PlanStepRecord[]) {
  return { id: "plan-int", sessionId: "s1", agentId: null, goal: "integration test", status: "executing" as const, createdAt: "", completedAt: null as string | null, steps };
}

function makeStep(id: string, overrides: Partial<PlanStepRecord> = {}): PlanStepRecord {
  return {
    id, planId: "plan-int", description: `Step ${id}`, tool: "websearch", args: "{}",
    dependsOn: "[]", status: "pending", result: null, error: null, order: 0,
    createdAt: "", completedAt: null, ...overrides,
  };
}

describe("Planning flow integration", () => {
  it("Test 1 — tool execution and synthesizer work end-to-end", async () => {
    const { WorkflowExecutor } = await import("@opencode/engine/planner/workflow.js");
    const { Synthesizer } = await import("@opencode/engine/planner/synthesizer.js");

    const tools = new Map<string, Tool>([
      ["websearch", successTool("websearch")],
      ["webfetch", successTool("webfetch")],
    ]);

    const steps = [
      makeStep("step_0", { tool: "websearch", args: JSON.stringify({ query: "AI news" }), order: 0 }),
      makeStep("step_1", { tool: "webfetch", args: JSON.stringify({ url: "https://example.com" }), dependsOn: '["step_0"]', order: 1 }),
    ];

    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const wfResult = await executor.execute(makePlan(steps), undefined);

    expect(wfResult.status).toBe("completed");
    expect(wfResult.completedSteps).toBe(2);

    const adapted = wfResult.results.filter((r) => r.status === "completed").map((r) => ({
      stepId: r.stepId,
      description: steps.find((s) => s.id === r.stepId)?.description ?? "",
      tool: steps.find((s) => s.id === r.stepId)?.tool ?? undefined,
      result: r.status === "completed" ? r.result : null,
      durationMs: r.durationMs,
    }));

    const llm = stepLLM([
      [{ content: "Synthesized response from tool results." }],
    ]);
    const synthesizer = new Synthesizer();
    const synthesis = await synthesizer.synthesize("integration test", adapted, llm, undefined);

    expect(synthesis.ok).toBe(true);
    if (synthesis.ok) {
      expect(synthesis.response.length).toBeGreaterThan(0);
    }
  });

  it("Test 2 — tool failure propagates blocked state", async () => {
    const { WorkflowExecutor } = await import("@opencode/engine/planner/workflow.js");

    const tools = new Map<string, Tool>([
      ["websearch", failingTool("websearch")],
      ["webfetch", successTool("webfetch")],
    ]);

    const steps = [
      makeStep("step_0", { tool: "websearch", args: "{}", order: 0 }),
      makeStep("step_1", { tool: "webfetch", args: "{}", dependsOn: '["step_0"]', order: 1 }),
    ];

    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const wfResult = await executor.execute(makePlan(steps), undefined);

    expect(wfResult.status).toBe("failed");
    expect(wfResult.failedSteps).toBe(1);
    expect(wfResult.results.some((r) => r.stepId === "step_1" && r.status === "blocked")).toBe(true);
  });

  it("Test 3 — recovery resume: completed steps skipped, pending executed", async () => {
    const { WorkflowExecutor } = await import("@opencode/engine/planner/workflow.js");

    const tools = new Map<string, Tool>([
      ["websearch", successTool("websearch")],
    ]);

    const steps = [
      makeStep("step_0", { status: "completed", result: "already done" }),
      makeStep("step_1", { status: "pending" }),
    ];

    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const wfResult = await executor.execute(makePlan(steps), undefined);

    expect(wfResult.status).toBe("completed");
    expect(wfResult.completedSteps).toBe(2);
    const resumed = wfResult.results.find((r) => r.stepId === "step_0");
    expect(resumed?.status).toBe("completed");
    expect(resumed?.result).toBe("already done");
  });

  it("Test 4 — recoverPlans + resumePlan from DB", async () => {
    const { sessions, plans, planSteps } = await import("@opencode/engine/persistence/schema.js");
    const { getDb } = await import("@opencode/engine/persistence/database.js");
    const db = getDb();
    const now = new Date().toISOString();
    const planId = "plan-recovery-test";

    db.insert(sessions).values({ id: "s1", query: "test", model: "gpt-4o", toolMode: "native", state: "completed", createdAt: now, updatedAt: now }).run();
    db.insert(plans).values({ id: planId, sessionId: "s1", agentId: null, goal: "recovery test", status: "executing", createdAt: now, completedAt: null }).run();
    db.insert(planSteps).values({ id: "rec_0", planId, description: "A", tool: "websearch", args: "{}", dependsOn: "[]", status: "completed", result: "done", error: null, order: 0, createdAt: now, completedAt: now }).run();
    db.insert(planSteps).values({ id: "rec_1", planId, description: "B", tool: "websearch", args: "{}", dependsOn: "[]", status: "running", result: null, error: null, order: 1, createdAt: now, completedAt: null }).run();
    db.insert(planSteps).values({ id: "rec_2", planId, description: "C", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 2, createdAt: now, completedAt: null }).run();

    const { recoverPlans, resumePlan } = await import("@opencode/engine/planner/recovery.js");
    const { WorkflowExecutor } = await import("@opencode/engine/planner/workflow.js");

    const tools = new Map<string, Tool>([["websearch", successTool("websearch")]]);
    const executor = new WorkflowExecutor({ tools, emit: () => undefined });

    const recovered = recoverPlans();
    expect(recovered.length).toBe(1);
    expect(recovered[0].id).toBe(planId);

    const wfResult = await resumePlan(planId, executor, undefined);
    expect(wfResult.status).toBe("completed");
    expect(wfResult.completedSteps).toBe(3);

    const r0 = wfResult.results.find((r) => r.stepId === "rec_0");
    expect(r0?.status).toBe("completed");
    expect(r0?.result).toBe("done");

    const r1 = wfResult.results.find((r) => r.stepId === "rec_1");
    expect(r1?.status).toBe("completed");

    const r2 = wfResult.results.find((r) => r.stepId === "rec_2");
    expect(r2?.status).toBe("completed");
  });

  it("Test 5 — abort before execution skips all steps", async () => {
    const { WorkflowExecutor } = await import("@opencode/engine/planner/workflow.js");

    const tools = new Map<string, Tool>([
      ["websearch", successTool("websearch")],
      ["webfetch", successTool("webfetch")],
    ]);

    const steps = [
      makeStep("step_0", { tool: "websearch", order: 0 }),
      makeStep("step_1", { tool: "webfetch", order: 1 }),
    ];

    const abortController = new AbortController();
    abortController.abort();

    const executor = new WorkflowExecutor({ tools, emit: () => undefined });
    const wfResult = await executor.execute(makePlan(steps), abortController.signal);

    expect(wfResult.status).toBe("failed");
    expect(wfResult.results.every((r) => r.status === "skipped")).toBe(true);
  });
});
