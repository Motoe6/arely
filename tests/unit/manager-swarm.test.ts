import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManagerSwarm } from "../../packages/engine/src/swarm/manager-swarm.js";
import type { HeterogeneousExecutor } from "../../packages/engine/src/llm/swarm-orchestrator.js";

// Mock cross-session memory for tests that need storage
vi.mock("@arelyos/memory", () => ({
  crossSessionMemory: {
    store: vi.fn().mockResolvedValue({ id: "mock-memory-id" }),
  },
}));

function mockExecutor(responses: Record<string, string> = {}): HeterogeneousExecutor {
  return vi.fn(
    async (
      _role: string,
      _systemPrompt: string,
      task: string,
      _context: string,
      _modelId?: string,
    ): Promise<string> => {
      for (const [key, value] of Object.entries(responses)) {
        if (task.toLowerCase().includes(key)) return value;
      }
      return "Mock result for: " + task.slice(0, 60);
    },
  );
}

describe("ManagerSwarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a simple goal and returns a result with plan and synthesis", async () => {
    const executor = mockExecutor();
    const swarm = new ManagerSwarm({ execute: executor, sessionId: "test-session" });
    const result = await swarm.execute("Write a one-paragraph summary");
    expect(result.success).toBe(true);
    expect(result.goal).toBe("Write a one-paragraph summary");
    expect(result.plan).toBeTruthy();
    expect(result.plan.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.synthesis).toBeTruthy();
    expect(result.sessionId).toBe("test-session");
  });

  it("uses storage memory when storeMemory is enabled", async () => {
    const executor = mockExecutor();
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "test-session-2",
      storeMemory: true,
    });
    const result = await swarm.execute("Summarize key findings");
    expect(result.success).toBe(true);
    expect(result.stored).toBe(true);
    expect(result.memoryIds).toHaveLength(1);
  });

  it("skips memory storage when storeMemory is false", async () => {
    const executor = mockExecutor();
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "test-session-3",
      storeMemory: false,
    });
    const result = await swarm.execute("Quick task");
    expect(result.stored).toBe(false);
    expect(result.memoryIds).toHaveLength(0);
  });

  it("handles sub-swarm failure with recovery (retry)", async () => {
    let callCount = 0;
    const executor = vi.fn(
      async (): Promise<string> => {
        callCount++;
        if (callCount <= 2) throw new Error("Transient LLM error");
        return "Recovered result";
      },
    );
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "recovery-test",
      recovery: { maxRetries: 2, enableSingleAgentFallback: false },
    });
    const result = await swarm.execute("Build a small CLI tool");
    expect(result.success).toBe(true);
    expect(result.synthesis).toBeTruthy();
  });

  it("falls back to single agent when sub-swarm fails all retries", async () => {
    const executor = vi.fn(
      async (
        role: string,
        _sp: string,
        _task: string,
        _ctx: string,
        modelId?: string,
      ): Promise<string> => {
        // Sub-swarm calls with researcher/coder role always fail
        // Single-agent fallback has modelId
        if (modelId) return "Fallback result from " + modelId;
        // Synthesis calls (synthesizer role) should succeed
        if (role === "synthesizer") return "Synthesis result";
        throw new Error("LLM unavailable");
      },
    );
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "fallback-test",
      recovery: { maxRetries: 0, enableSingleAgentFallback: true },
    });
    const result = await swarm.execute("Test fallback");
    expect(result.success).toBe(true);
    expect(result.synthesis).toBeTruthy();
  });

  it("reports failure when all recovery options exhausted", async () => {
    const executor = vi.fn(
      async (): Promise<string> => {
        throw new Error("Permanent error");
      },
    );
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "fail-test",
      recovery: { maxRetries: 0, enableSingleAgentFallback: false },
    });
    const result = await swarm.execute("Will fail");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("executes multi-phase tasks in dependency order", async () => {
    const log: string[] = [];
    const executor = vi.fn(
      async (_role: string, _sp: string, _task: string): Promise<string> => {
        log.push("called");
        return "done";
      },
    );
    const swarm = new ManagerSwarm({
      execute: executor,
      sessionId: "order-test",
    });
    // Override planner to produce known phases
    const manualPlan = {
      planId: "plan-1",
      sessionId: "order-test",
      goal: "Multi-phase task",
      tasks: [
        { taskId: "T1", title: "Research", description: "Research phase", category: "research" as const, dependencies: [], priority: 1, estimatedComplexity: "low" as const },
        { taskId: "T2", title: "Coding", description: "Coding phase", category: "coding" as const, dependencies: ["T1"], priority: 2, estimatedComplexity: "low" as const },
        { taskId: "T3", title: "Synthesis", description: "Write output", category: "writing" as const, dependencies: ["T2"], priority: 3, estimatedComplexity: "low" as const },
      ],
      phases: [["T1"], ["T2"], ["T3"]],
      estimatedComplexity: "low" as const,
      metadata: {},
    };
    // @ts-ignore - accessing private for test
    swarm["planner"] = { createPlan: () => manualPlan };
    await swarm.execute("Multi-phase task");
    // 3 tasks + 1 synthesize call = 4 total LLM calls
    expect(log.length).toBe(4);
    // First call should be Research (T1)
    expect(executor.mock.calls[0][2]).toContain("Research");
    // Second call should be Coding (T2)
    expect(executor.mock.calls[1][2]).toContain("Coding");
    // Third call should be Write output (T3)
    expect(executor.mock.calls[2][2]).toContain("Write output");
  });
});
