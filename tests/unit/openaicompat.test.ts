import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMessage } from "@arely/engine/types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

async function collectGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

function createStreamChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

import { OpenAICompatAdapter } from "@arely/engine/llm/openaicompat.js";

describe("OpenAICompatAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should yield text content from LLM response", async () => {
    const responseBody = createStreamChunks([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      "data: [DONE]\n",
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: responseBody,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o",
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Hello", timestamp: Date.now() },
    ];

    const results = await collectGenerator(adapter.complete(messages));

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Hello world");
    expect(results[0].toolCalls).toBeUndefined();
  });

  it("should yield tool calls from LLM response", async () => {
    const responseBody = createStreamChunks([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"websearch","arguments":""}}]},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"test\\"}"}}]},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: responseBody,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o",
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Search", timestamp: Date.now() },
    ];

    const results = await collectGenerator(adapter.complete(messages));

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("");
    expect(results[0].toolCalls).toHaveLength(1);
    expect(results[0].toolCalls![0].name).toBe("websearch");
    expect(results[0].toolCalls![0].args).toEqual({ query: "test" });
  });

  it("should handle API error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-bad",
      "gpt-4o",
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(collectGenerator(adapter.complete(messages))).rejects.toThrow(
      "LLM API error 401: Unauthorized",
    );
  });

  it("should handle empty response body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o",
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(collectGenerator(adapter.complete(messages))).rejects.toThrow(
      "No response body",
    );
  });

  it("should parse text tool calls in text mode", async () => {
    const responseBody = createStreamChunks([
      'data: {"choices":[{"delta":{"content":"Let me search for you.\\n```json\\n{\\"tool\\": \\"websearch\\", \\"args\\": {\\"query\\": \\"hello\\"}}\\n```"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: responseBody,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o",
      true,
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Search", timestamp: Date.now() },
    ];

    const results = await collectGenerator(adapter.complete(messages));

    // text mode yields: 1) raw content with embedded tool call, 2) cleaned content + parsed toolCalls
    expect(results).toHaveLength(2);
    expect(results[1].content).toBe("Let me search for you.");
    expect(results[1].toolCalls).toHaveLength(1);
    expect(results[1].toolCalls![0].name).toBe("websearch");
  });

  it("should not parse text tool calls in native mode", async () => {
    const responseBody = createStreamChunks([
      'data: {"choices":[{"delta":{"content":"Here is a JSON tool call in text.\\n```json\\n{\\"tool\\": \\"websearch\\", \\"args\\": {\\"query\\": \\"x\\"}}\\n```"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: responseBody,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://api.openai.com/v1",
      "sk-test",
      "gpt-4o",
      false,
    );

    const messages: SessionMessage[] = [
      { role: "user", content: "Search", timestamp: Date.now() },
    ];

    const results = await collectGenerator(adapter.complete(messages));

    expect(results).toHaveLength(1);
    expect(results[0].toolCalls).toBeUndefined();
    expect(results[0].content).toContain("websearch");
  });

  it("should pass correct API request", async () => {
    const responseBody = createStreamChunks([
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n',
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: responseBody,
      text: vi.fn(),
    });

    const adapter = new OpenAICompatAdapter(
      "https://custom.api.com/v1",
      "sk-custom",
      "gpt-4o-mini",
    );

    const messages: SessionMessage[] = [
      { role: "system", content: "You are helpful", timestamp: Date.now() },
      { role: "user", content: "Hello", timestamp: Date.now() },
    ];

    await collectGenerator(adapter.complete(messages));

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-custom",
        },
        body: expect.stringContaining('"model":"gpt-4o-mini"'),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("default auth header is Authorization: Bearer", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createStreamChunks(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n', "data: [DONE]\n"]),
      text: vi.fn(),
    });
    const adapter = new OpenAICompatAdapter("https://api.openai.com/v1", "sk-test", "gpt-4o");
    await collectGenerator(adapter.complete([{ role: "user", content: "hi", timestamp: Date.now() }]));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("Gemini-style X-Goog-Api-Key with empty prefix", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createStreamChunks(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n', "data: [DONE]\n"]),
      text: vi.fn(),
    });
    const adapter = new OpenAICompatAdapter("https://generativelanguage.googleapis.com/v1beta/openai", "AIza-test", "gemini-2.0-flash", false, "X-Goog-Api-Key", "");
    await collectGenerator(adapter.complete([{ role: "user", content: "hi", timestamp: Date.now() }]));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Goog-Api-Key": "AIza-test" }),
      }),
    );
  });

  it("custom header and prefix", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createStreamChunks(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n', "data: [DONE]\n"]),
      text: vi.fn(),
    });
    const adapter = new OpenAICompatAdapter("https://api.example.com/v1", "test-key", "custom-model", false, "Api-Key", "Token");
    await collectGenerator(adapter.complete([{ role: "user", content: "hi", timestamp: Date.now() }]));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "Api-Key": "Token test-key" }),
      }),
    );
  });
});
