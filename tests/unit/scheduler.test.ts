import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockListAgents = vi.hoisted(() => vi.fn());
const mockExecuteAgent = vi.hoisted(() => vi.fn());
const mockListPlansByAgent = vi.hoisted(() => vi.fn());

vi.mock("@opencode/engine/agents/agent-store.js", () => ({
  listAgents: mockListAgents,
}));

vi.mock("@opencode/engine/agents/runtime.js", () => ({
  executeAgent: mockExecuteAgent,
}));

vi.mock("@opencode/engine/persistence/plan-store.js", () => ({
  listPlansByAgent: mockListPlansByAgent,
}));

vi.mock("@opencode/engine/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { AgentScheduler } from "@opencode/engine/agents/scheduler.js";

describe("AgentScheduler", () => {
  let scheduler: AgentScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockListPlansByAgent.mockReturnValue([]);
    scheduler = new AgentScheduler({} as never, 1000);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it("start and stop cycle", () => {
    mockListAgents.mockReturnValue([]);
    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it("executes enabled interval agents on tick", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([
      { id: "agent-1", goal: "goal 1", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(mockExecuteAgent).toHaveBeenCalledTimes(1);
    expect(mockExecuteAgent).toHaveBeenCalledWith("agent-1", expect.anything());
  });

  it("skips agents with no plans when no prior execution", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([]);

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(mockExecuteAgent).not.toHaveBeenCalled();
  });

  it("skips agents whose trigger is not yet due", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([
      { id: "agent-1", goal: "goal", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 5000 }) },
    ]);
    mockListPlansByAgent.mockReturnValue([
      { createdAt: new Date(Date.now() - 1000).toISOString() },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(mockExecuteAgent).not.toHaveBeenCalled();
  });

  it("executes agent when interval has elapsed", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([
      { id: "agent-1", goal: "goal", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
    ]);
    mockListPlansByAgent.mockReturnValue([
      { createdAt: new Date(Date.now() - 1000).toISOString() },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(mockExecuteAgent).toHaveBeenCalledWith("agent-1", expect.anything());
  });

  it("prevents concurrent execution of the same agent", async () => {
    let resolveExecution: () => void;
    const executionPromise = new Promise<void>((resolve) => { resolveExecution = resolve; });
    mockExecuteAgent.mockReturnValue(executionPromise);
    mockListAgents.mockReturnValue([
      { id: "agent-1", goal: "goal", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(500);
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1);

    resolveExecution!();
    await executionPromise;
  });

  it("stop prevents further executions", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([
      { id: "agent-1", goal: "goal", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(500);
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1);

    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1);
  });

  it("multiple agents run independently", () => {
    mockExecuteAgent.mockResolvedValue({ ok: true });
    mockListAgents.mockReturnValue([
      { id: "agent-a", goal: "goal a", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
      { id: "agent-b", goal: "goal b", enabled: true, trigger: "interval", triggerConfig: JSON.stringify({ intervalMs: 500 }) },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(mockExecuteAgent).toHaveBeenCalledWith("agent-a", expect.anything());
    expect(mockExecuteAgent).toHaveBeenCalledWith("agent-b", expect.anything());
  });
});
