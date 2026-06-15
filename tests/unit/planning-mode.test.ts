import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMAdapter } from "@arelyos/engine/llm/adapter.js";
import type { SessionMessage } from "@arelyos/engine/types.js";

const { mockCreatePlan, mockPersistPlan, mockCreateSteps, mockUpdatePlanStatus, mockExecute, mockSynthesize } = vi.hoisted(() => ({
  mockCreatePlan: vi.fn(),
  mockPersistPlan: vi.fn(),
  mockCreateSteps: vi.fn(),
  mockUpdatePlanStatus: vi.fn(),
  mockExecute: vi.fn(),
  mockSynthesize: vi.fn(),
}));

vi.mock("@arelyos/engine/planner/planner.js", () => ({
  createPlan: mockCreatePlan,
}));

vi.mock("@arelyos/engine/persistence/plan-store.js", () => ({
  createPlan: mockPersistPlan,
  createSteps: mockCreateSteps,
  updatePlanStatus: mockUpdatePlanStatus,
  markStepRunning: vi.fn(),
  markStepCompleted: vi.fn(),
  markStepFailed: vi.fn(),
  markStepBlocked: vi.fn(),
  markStepSkipped: vi.fn(),
}));

vi.mock("@arelyos/engine/planner/workflow.js", () => ({
  WorkflowExecutor: vi.fn(function () {
    return { execute: mockExecute };
  }),
}));

vi.mock("@arelyos/engine/planner/synthesizer.js", () => ({
  Synthesizer: vi.fn(function () {
    return { synthesize: mockSynthesize };
  }),
}));

import { PlanningModeExecution } from "@arelyos/engine/server/modes/planning-mode.js";

const mockMessages: SessionMessage[] = [];
const mockEmit = vi.fn();

function makeSession() {
  return {
    id: "test-session",
    abortSignal: new AbortController().signal,
    llm: {} as LLMAdapter,
    tools: new Map(),
    sse: { emit: mockEmit },
    messages: mockMessages,
    pushMessage: vi.fn((role: string, content: string) => {
      const msg: SessionMessage = { role: role as "user" | "assistant" | "system", content, timestamp: Date.now() };
      mockMessages.push(msg);
      return msg;
    }),
  };
}

describe("PlanningModeExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages.length = 0;
  });

  it("returns planner error when planner fails", async () => {
    mockCreatePlan.mockResolvedValue({ ok: false, error: "LLM error" });

    const session = makeSession();
    const mode = new PlanningModeExecution();
    const result = await mode.run(session as never, "test goal");

    expect(result.content).toBe("LLM error");
    expect(result.turns).toBe(0);
    expect(mockPersistPlan).not.toHaveBeenCalled();
    expect(mockCreateSteps).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockMessages.length).toBe(1);
    expect(mockMessages[0].content).toBe("LLM error");
  });

  it("executes workflow and synthesizes on success", async () => {
    const planId = "plan-1";
    mockCreatePlan.mockResolvedValue({
      ok: true,
      plan: { id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null },
      steps: [
        { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
      ],
    });
    mockPersistPlan.mockReturnValue({ id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null });
    mockCreateSteps.mockReturnValue([
      { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
    ]);
    mockExecute.mockResolvedValue({
      planId,
      status: "completed",
      completedSteps: 1,
      failedSteps: 0,
      executionTimeMs: 100,
      results: [
        { stepId: "step_0", status: "completed", result: "Found data", durationMs: 50 },
      ],
    });
    mockSynthesize.mockResolvedValue({ ok: true, response: "Final answer" });

    const session = makeSession();
    const mode = new PlanningModeExecution();
    const result = await mode.run(session as never, "test goal");

    expect(result.content).toBe("Final answer");
    expect(result.turns).toBe(1);
    expect(mockPersistPlan).toHaveBeenCalled();
    expect(mockCreateSteps).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalled();
    expect(mockUpdatePlanStatus).toHaveBeenCalledWith(planId, "completed");
    expect(mockMessages.length).toBe(1);
    expect(mockMessages[0].content).toBe("Final answer");
  });

  it("handles partial workflow failure gracefully", async () => {
    const planId = "plan-2";
    mockCreatePlan.mockResolvedValue({
      ok: true,
      plan: { id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null },
      steps: [
        { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
        { id: "step_1", planId, description: "Fetch", tool: "webfetch", args: "{}", dependsOn: '["step_0"]', status: "pending", result: null, error: null, order: 1, createdAt: "", completedAt: null },
      ],
    });
    mockPersistPlan.mockReturnValue({ id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null });
    mockCreateSteps.mockReturnValue([
      { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
      { id: "step_1", planId, description: "Fetch", tool: "webfetch", args: "{}", dependsOn: '["step_0"]', status: "pending", result: null, error: null, order: 1, createdAt: "", completedAt: null },
    ]);
    mockExecute.mockResolvedValue({
      planId,
      status: "failed",
      completedSteps: 1,
      failedSteps: 1,
      executionTimeMs: 200,
      results: [
        { stepId: "step_0", status: "completed", result: "Found data", durationMs: 50 },
        { stepId: "step_1", status: "failed", error: "timeout", durationMs: 150 },
      ],
    });
    mockSynthesize.mockResolvedValue({ ok: true, response: "Partial answer" });

    const session = makeSession();
    const mode = new PlanningModeExecution();
    const result = await mode.run(session as never, "test goal");

    expect(result.content).toBe("Partial answer");
    expect(mockUpdatePlanStatus).toHaveBeenCalledWith(planId, "failed");
    expect(mockSynthesize).toHaveBeenCalledWith(
      "test goal",
      expect.arrayContaining([
        expect.objectContaining({ stepId: "step_0", result: "Found data" }),
      ]),
      expect.anything(),
      expect.anything(),
    );
    expect(mockSynthesize.mock.calls[0][1]).toHaveLength(1);
  });

  it("uses fallback when synthesizer fails", async () => {
    const planId = "plan-3";
    mockCreatePlan.mockResolvedValue({
      ok: true,
      plan: { id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null },
      steps: [
        { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
      ],
    });
    mockPersistPlan.mockReturnValue({ id: planId, sessionId: "s1", agentId: null, goal: "test", status: "pending", createdAt: "", completedAt: null });
    mockCreateSteps.mockReturnValue([
      { id: "step_0", planId, description: "Search", tool: "websearch", args: "{}", dependsOn: "[]", status: "pending", result: null, error: null, order: 0, createdAt: "", completedAt: null },
    ]);
    mockExecute.mockResolvedValue({
      planId,
      status: "completed",
      completedSteps: 1,
      failedSteps: 0,
      executionTimeMs: 100,
      results: [
        { stepId: "step_0", status: "completed", result: "Found data", durationMs: 50 },
      ],
    });
    mockSynthesize.mockResolvedValue({ ok: false, error: "Synthesis failed" });

    const session = makeSession();
    const mode = new PlanningModeExecution();
    const result = await mode.run(session as never, "test goal");

    expect(result.content).toBe("Workflow completed. Review the results above.");
  });

  it("handles abort signal before planning", async () => {
    const session = makeSession();
    session.abortSignal = AbortSignal.abort();

    const mode = new PlanningModeExecution();
    const result = await mode.run(session as never, "test goal");

    expect(result.content).toBe("Plan cancelled");
    expect(result.turns).toBe(0);
    expect(mockCreatePlan).not.toHaveBeenCalled();
  });
});
