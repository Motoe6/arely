import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMAdapter, LLMResponse } from "@opencode/engine/llm/adapter.js";
import type { SessionMessage } from "@opencode/engine/types.js";
import type { Tool, ToolResult } from "@opencode/engine/tools/base-tool.js";

const emittedEvents: any[] = [];

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

function createMockTool(name: string, result: ToolResult = { content: "tool result" }): Tool {
  return {
    name,
    description: `Mock ${name}`,
    execute: vi.fn().mockResolvedValue(result),
  };
}

function createMockFailingTool(name: string, errorMsg = "Execution failed"): Tool {
  return {
    name,
    description: `Failing ${name}`,
    execute: vi.fn().mockRejectedValue(new Error(errorMsg)),
  };
}

import { runAgentLoop } from "@opencode/engine/server/agent-loop.js";

describe("AgentLoop", () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    vi.clearAllMocks();
  });

  function emit(event: any): void {
    emittedEvents.push(event);
  }

  it("should return content when LLM responds with text only", async () => {
    const llm = createStepMockLLM([[{ content: "Hello world" }]]);
    const tools = new Map<string, Tool>();
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm,
      messages,
      tools,
      emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(result.content).toBe("Hello world");
    expect(result.turns).toBe(1);
  });

  it("should execute tool calls and return final content", async () => {
    const llm = createStepMockLLM([
      [{ content: "", toolCalls: [{ name: "websearch", args: { query: "test" } }] }],
      [{ content: "Final answer" }],
    ]);
    const tools = new Map<string, Tool>([
      ["websearch", createMockTool("websearch", { content: "Search results" })],
    ]);
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm,
      messages,
      tools,
      emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(result.content).toBe("Final answer");
    expect(result.turns).toBe(2);
    expect(emittedEvents.some((e) => e.type === "session_thinking")).toBe(true);
    expect(emittedEvents.some((e) => e.type === "tool_result_received")).toBe(true);
    expect(emittedEvents.some((e) => e.type === "agent_loop_completed")).toBe(true);
  });

  it("should handle unknown tool gracefully", async () => {
    const llm = createStepMockLLM([
      [{ content: "", toolCalls: [{ name: "nonexistent", args: {} }] }],
      [{ content: "Done" }],
    ]);
    const tools = new Map<string, Tool>();
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(result.content).toBe("Done");
    expect(messages.some((m) => m.content.includes("Unknown tool"))).toBe(true);
  });

  it("should handle tool execution error gracefully", async () => {
    const llm = createStepMockLLM([
      [{ content: "", toolCalls: [{ name: "webfetch", args: { url: "https://x.com" } }] }],
      [{ content: "Recovered" }],
    ]);
    const tools = new Map<string, Tool>([
      ["webfetch", createMockFailingTool("webfetch", "Network error")],
    ]);
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(result.content).toBe("Recovered");
    expect(messages.some((m) => m.content.includes("Error executing"))).toBe(true);
  });

  it("should return agent_loop_failed when LLM throws", async () => {
    const llm: LLMAdapter = {
      complete: vi.fn().mockImplementation(async function* () {
        throw new Error("API error");
      }),
    };
    const tools = new Map<string, Tool>();
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(emittedEvents.some((e) => e.type === "agent_loop_failed")).toBe(true);
    expect(result.turns).toBe(1);
  });

  it("should abort when signal is aborted", async () => {
    const abortController = new AbortController();
    const llm = createStepMockLLM([[{ content: "Will be aborted" }]]);
    const tools = new Map<string, Tool>();
    const messages: SessionMessage[] = [];
    abortController.abort();

    const result = await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
      signal: abortController.signal,
    });

    expect(emittedEvents.some((e) => e.type === "agent_loop_failed" && e.error === "Aborted")).toBe(true);
    expect(result.turns).toBe(0);
  });

  it("should stop at maxIterations", async () => {
    let callCount = 0;
    const llm: LLMAdapter = {
      complete: vi.fn().mockImplementation(async function* () {
        callCount++;
        yield { content: "", toolCalls: [{ name: "websearch", args: { query: "test" } }] };
      }),
    };
    const tools = new Map<string, Tool>([
      ["websearch", createMockTool("websearch")],
    ]);
    const messages: SessionMessage[] = [];

    const result = await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 3,
    });

    expect(result.turns).toBe(3);
    expect(callCount).toBe(3);
  });

  it("should emit assistant_message_created when tool calls with content", async () => {
    const llm = createStepMockLLM([
      [{ content: "Let me search", toolCalls: [{ name: "websearch", args: { query: "test" } }] }],
      [{ content: "Done" }],
    ]);
    const tools = new Map<string, Tool>([
      ["websearch", createMockTool("websearch")],
    ]);
    const messages: SessionMessage[] = [];

    await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(emittedEvents.some((e) => e.type === "assistant_message_created")).toBe(true);
    expect(emittedEvents.some((e) => e.type === "assistant_message_completed")).toBe(true);
  });

  it("should populate messages array with assistant responses", async () => {
    const llm = createStepMockLLM([[{ content: "Hello" }]]);
    const tools = new Map<string, Tool>();
    const messages: SessionMessage[] = [];

    await runAgentLoop({
      llm, messages, tools, emit,
      sessionId: "s1",
      maxIterations: 5,
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toBe("Hello");
  });
});
