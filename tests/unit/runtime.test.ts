import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAgent = vi.hoisted(() => vi.fn());
const mockListPlansBySession = vi.hoisted(() => vi.fn());
const mockUpdatePlanAgentId = vi.hoisted(() => vi.fn());

vi.mock("../../src/agents/agent-store.js", () => ({
  getAgent: mockGetAgent,
}));

vi.mock("../../src/persistence/plan-store.js", () => ({
  listPlansBySession: mockListPlansBySession,
  updatePlanAgentId: mockUpdatePlanAgentId,
}));

vi.mock("../../src/config/index.js", () => ({
  getConfig: () => ({
    OPENCODE_PERMIT_WEBSEARCH: "allow",
    OPENCODE_PERMIT_WEBFETCH: "allow",
    OPENCODE_WEBSEARCH_PROVIDER: "exa",
    OPENCODE_MODEL: "gpt-4o",
    OPENCODE_TOOL_MODE: "native",
    PLAN_PARALLELISM: 3,
  }),
}));

import { executeAgent } from "../../src/agents/runtime.js";

function makeSessionManager(session: { id: string; run: ReturnType<typeof vi.fn> }) {
  return { createSession: vi.fn().mockReturnValue(session) } as never;
}

describe("AgentRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error for nonexistent agent", async () => {
    mockGetAgent.mockReturnValue(undefined);
    const result = await executeAgent("no-such-agent", { sessionManager: {} as never, llm: {} as never });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Agent not found");
  });

  it("returns error for disabled agent", async () => {
    mockGetAgent.mockReturnValue({ enabled: false });
    const result = await executeAgent("disabled-agent", { sessionManager: {} as never, llm: {} as never });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Agent disabled");
  });

  it("creates session and runs planning mode for enabled agent", async () => {
    const mockSession = { id: "session-1", run: vi.fn().mockResolvedValue(undefined) };
    mockGetAgent.mockReturnValue({ id: "agent-1", goal: "test goal", enabled: true });
    mockListPlansBySession.mockReturnValue([{ id: "plan-1" }]);

    const sm = makeSessionManager(mockSession);
    const result = await executeAgent("agent-1", { sessionManager: sm, llm: {} as never });

    expect(result.ok).toBe(true);
    expect(sm.createSession).toHaveBeenCalledTimes(1);
    const createArgs = sm.createSession.mock.calls[0];
    expect(createArgs[2].mode).toBe("planning");
    expect(mockSession.run).toHaveBeenCalledWith("test goal");
    expect(mockUpdatePlanAgentId).toHaveBeenCalledWith("plan-1", "agent-1");
  });

  it("sets agentId on the last plan for the session", async () => {
    const mockSession = { id: "session-2", run: vi.fn().mockResolvedValue(undefined) };
    mockGetAgent.mockReturnValue({ id: "agent-2", goal: "goal", enabled: true });
    mockListPlansBySession.mockReturnValue([{ id: "plan-old" }, { id: "plan-latest" }]);

    const sm = makeSessionManager(mockSession);
    await executeAgent("agent-2", { sessionManager: sm, llm: {} as never });

    expect(mockUpdatePlanAgentId).toHaveBeenCalledWith("plan-latest", "agent-2");
  });

  it("captures session.run error and returns ok=false", async () => {
    const mockSession = { id: "session-3", run: vi.fn().mockRejectedValue(new Error("LLM failure")) };
    mockGetAgent.mockReturnValue({ id: "agent-3", goal: "goal", enabled: true });
    mockListPlansBySession.mockReturnValue([]);

    const sm = makeSessionManager(mockSession);
    const result = await executeAgent("agent-3", { sessionManager: sm, llm: {} as never });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("LLM failure");
  });
});
