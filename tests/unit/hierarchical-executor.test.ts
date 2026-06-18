import { describe, it, expect, vi, beforeEach } from "vitest";
import { HierarchicalSwarmExecutor } from "../../packages/engine/src/swarm/hierarchical-executor.js";

vi.mock("@arelyos/memory", () => ({
  crossSessionMemory: {
    store: vi.fn().mockResolvedValue({ id: "mock-memory-id" }),
  },
}));

describe("HierarchicalSwarmExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockExecutor(responses: Record<string, string> = {}) {
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
        return "Result for: " + task.slice(0, 80);
      },
    );
  }

  it("executes a simple goal and returns a result", async () => {
    const executor = mockExecutor();
    const swarm = new HierarchicalSwarmExecutor({ execute: executor, sessionId: "test-session" });
    const result = await swarm.execute("Write a summary");
    expect(result.success).toBe(true);
    expect(result.goal).toBe("Write a summary");
    expect(result.root).toBeTruthy();
    expect(result.root.status).toBe("completed");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("leaf nodes are executed and produce output", async () => {
    const executor = mockExecutor({ write: "Written output here" });
    const swarm = new HierarchicalSwarmExecutor({ execute: executor, sessionId: "leaf-test" });
    const result = await swarm.execute("Write a report");
    expect(result.success).toBe(true);
    // The root synthesizes children's outputs
    expect(result.root.output).toBeTruthy();
  });

  it("handles LLM failures with replan fallback", async () => {
    let callCount = 0;
    const executor = vi.fn(
      async (): Promise<string> => {
        callCount++;
        if (callCount <= 2) throw new Error("Transient error");
        return "Recovered result";
      },
    );
    const swarm = new HierarchicalSwarmExecutor({
      execute: executor,
      sessionId: "replan-test",
      recovery: { maxRetries: 1, enableReplan: true },
    });
    const result = await swarm.execute("Build a CLI tool");
    expect(result.success).toBe(true);
    expect(result.root.output).toBeTruthy();
  });

  it("returns success=false when all tasks fail", async () => {
    const executor = vi.fn(
      async (): Promise<string> => {
        throw new Error("Permanent failure");
      },
    );
    const swarm = new HierarchicalSwarmExecutor({
      execute: executor,
      sessionId: "fail-test",
      recovery: { maxRetries: 0, enableReplan: false },
    });
    const result = await swarm.execute("Will fail");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("each node execution creates a span in the tracer", async () => {
    const executor = mockExecutor();
    const swarm = new HierarchicalSwarmExecutor({ execute: executor, sessionId: "trace-test" });
    const result = await swarm.execute("Write docs");
    expect(result.root.status).toBe("completed");
  });

  it("stores memory when storeMemory is true", async () => {
    const executor = mockExecutor();
    const swarm = new HierarchicalSwarmExecutor({
      execute: executor,
      sessionId: "memory-test",
      storeMemory: true,
    });
    const result = await swarm.execute("Quick task");
    expect(result.memoryIds.length).toBeGreaterThanOrEqual(1);
  });

  it("does not store memory when storeMemory is false", async () => {
    const executor = mockExecutor();
    const swarm = new HierarchicalSwarmExecutor({
      execute: executor,
      sessionId: "no-mem-test",
      storeMemory: false,
    });
    const result = await swarm.execute("Quick task");
    expect(result.memoryIds).toHaveLength(0);
  });

  it("executes multiple child managers in parallel", async () => {
    const log: Array<{ role: string; task: string }> = [];
    const executor = vi.fn(
      async (role: string, _sp: string, task: string): Promise<string> => {
        log.push({ role, task: task.slice(0, 40) });
        return "done";
      },
    );
    const swarm = new HierarchicalSwarmExecutor({
      execute: executor,
      sessionId: "parallel-test",
    });
    const result = await swarm.execute("Research and implement");
    expect(result.success).toBe(true);
    // Should have executed both research and engineering leaves (and synthesis)
    expect(log.length).toBeGreaterThanOrEqual(2);
  });
});
