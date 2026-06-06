import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import type { SessionMessage } from "@opencode/engine/types.js";
import type { LLMAdapter, LLMResponse } from "@opencode/engine/llm/adapter.js";

const mockEmit = vi.fn();

vi.mock("@opencode/engine/tools/websearch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    performWebSearch: vi.fn().mockResolvedValue([
      { title: "Result", url: "https://example.com", content: "Test" },
    ]),
  };
});

vi.mock("@opencode/engine/tools/webfetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    performWebFetch: vi.fn().mockResolvedValue({
      url: "https://example.com", title: "Example", content: "# Page",
    }),
  };
});

vi.mock("@opencode/engine/config/index.js", () => ({
  loadConfig: vi.fn(),
  getConfig: () => ({
    TOOL_TIMEOUT_MS: 5000,
    PERMISSION_TIMEOUT_MS: 5000,
    OPENCODE_PERMIT_WEBSEARCH: "allow",
    OPENCODE_PERMIT_WEBFETCH: "allow",
    CIRCUIT_BREAKER_ENABLED: false,
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_RESET_MS: 30000,
    RETRY_ENABLED: false,
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BASE_DELAY_MS: 1000,
    RETRY_MAX_DELAY_MS: 30000,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_DEFAULT_MAX: 30,
    RATE_LIMIT_DEFAULT_WINDOW_MS: 60000,
    OPENCODE_MAX_ITERATIONS: 10,
    OPENCODE_STREAMING: true,
    OPENCODE_TOOL_MODE: "native",
  }),
}));

vi.mock("@opencode/engine/persistence/approval-cache-store.js", () => ({
  findMatchingApproval: vi.fn(),
  setApproval: vi.fn(),
}));

import { AgentSession } from "@opencode/engine/server/session.js";

function createSseMock() {
  return { emit: mockEmit };
}

function createStepMockLLM(responses: LLMResponse[][]): LLMAdapter {
  let callIndex = 0;
  return {
    complete: vi.fn().mockImplementation(async function* () {
      const batch = responses[callIndex] ?? [];
      callIndex++;
      for (const r of batch) {
        yield r;
      }
    }),
  };
}

beforeEach(() => {
  initTestDb();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanupTestDb();
});

describe("AgentSession integration", () => {
  it("should run a session with text-only LLM response", async () => {
    const sse = createSseMock() as any;
    const llm = createStepMockLLM([
      [{ content: "Hello, I am the assistant." }],
    ]);

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    await session.run("Say hello");

    expect(session.state).toBe("completed");
    expect(session.messages.length).toBeGreaterThanOrEqual(2);

    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("session_started");
    expect(eventTypes).toContain("session_state_change");
    expect(eventTypes).toContain("session_thinking");
    expect(eventTypes).toContain("agent_loop_completed");
    expect(eventTypes).toContain("session_completed");
  });

  it("should execute tool calls and incorporate results", async () => {
    const sse = createSseMock() as any;
    const llm = createStepMockLLM([
      [
        {
          content: "",
          toolCalls: [{ name: "websearch", args: { query: "test", numResults: 3 } }],
        },
      ],
      [{ content: "Here are the results." }],
    ]);

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    await session.run("Search for test");

    expect(session.state).toBe("completed");
    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("tool_call_completed");
    expect(session.messages.some((m) => m.content.includes("Here are the results"))).toBe(true);
  });

  it("should keep messages in-memory during the session", async () => {
    const sse = createSseMock() as any;
    const llm = createStepMockLLM([
      [{ content: "Kept in memory" }],
    ]);

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    await session.run("Test persistence");

    expect(session.messages.some((m) => m.role === "user" && m.content === "Test persistence")).toBe(true);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "Kept in memory")).toBe(true);
  });

  it("should be abortable mid-execution", async () => {
    const sse = createSseMock() as any;

    let resumeResolve: (() => void) | null = null;
    const resumePromise = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    const llm: LLMAdapter = {
      complete: vi.fn().mockImplementation(async function* () {
        await resumePromise;
        yield { content: "Will not reach here" };
      }),
    };

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    const runPromise = session.run("Test abort");

    session.abort();
    resumeResolve?.();

    await runPromise;

    expect(session.state).toBe("error");
    const eventTypes = mockEmit.mock.calls.map((c: any[]) => c[1].type);
    expect(eventTypes).toContain("session_completed");
  });

  it("should handle tool execution failure gracefully", async () => {
    const sse = createSseMock() as any;
    const llm = createStepMockLLM([
      [
        {
          content: "",
          toolCalls: [{ name: "websearch", args: { query: "fail" } }],
        },
      ],
      [{ content: "Recovered from error." }],
    ]);

    const websearch = await import("@opencode/engine/tools/websearch.js");
    (websearch.performWebSearch as any).mockRejectedValue(new Error("Service unavailable"));

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    await session.run("Search");

    expect(session.state).toBe("completed");
    expect(session.messages.some((m) => m.content.includes("Error executing"))).toBe(true);
    expect(session.messages.some((m) => m.content.includes("Recovered"))).toBe(true);
  });

  it("should stop at max iterations and emit agent_loop_completed", async () => {
    const sse = createSseMock() as any;
    let callCount = 0;
    const llm: LLMAdapter = {
      complete: vi.fn().mockImplementation(async function* () {
        callCount++;
        yield {
          content: "",
          toolCalls: [{ name: "websearch", args: { query: "loop" } }],
        };
      }),
    };

    const session = new AgentSession(sse, llm, {
      permissions: { websearch: "allow", webfetch: "allow" },
      model: "gpt-4o",
    });

    await session.run("Loop test");

    expect(session.state).toBe("completed");
  });
});
