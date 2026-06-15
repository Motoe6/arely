import { describe, it, expect } from "vitest";
import { extractMemories, extractEpochSummary } from "@arely/engine/llm/auto-memory-extractor.js";
import type { LLMAdapter } from "@arely/engine/llm/adapter.js";
import type { SessionMessage } from "@arely/engine/types.js";

function mockLLM(response: string): LLMAdapter {
  return {
    async *complete(_messages: SessionMessage[], _signal?: AbortSignal) {
      yield { content: response };
    },
  };
}

describe("extractMemories", () => {
  it("returns parsed memories from valid JSON response", async () => {
    const llm = mockLLM(JSON.stringify([
      { type: "user_preference", key: "likes_python", value: "User prefers Python", confidence: 90, tags: ["language"] },
      { type: "project_fact", key: "uses_vitest", value: "Project uses Vitest for testing", confidence: 95, tags: ["testing"] },
    ]));

    const result = await extractMemories(
      [{ role: "user", content: "I like Python" }],
      { llm },
    );

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("user_preference");
    expect(result[0].key).toBe("likes_python");
    expect(result[0].value).toBe("User prefers Python");
    expect(result[0].confidence).toBe(90);
    expect(result[0].source).toBe("inferred");
    expect(result[0].tags).toEqual(["language"]);
    expect(result[1].type).toBe("project_fact");
    expect(result[1].key).toBe("uses_vitest");
  });

  it("returns empty array for non-array JSON", async () => {
    const llm = mockLLM(JSON.stringify({ type: "user_preference", key: "test" }));
    const result = await extractMemories([{ role: "user", content: "hi" }], { llm });
    expect(result).toEqual([]);
  });

  it("returns empty array for unparseable LLM output", async () => {
    const llm = mockLLM("not valid json at all");
    const result = await extractMemories([{ role: "user", content: "hi" }], { llm });
    expect(result).toEqual([]);
  });

  it("filters out incomplete entries", async () => {
    const llm = mockLLM(JSON.stringify([
      { type: "user_preference", key: "valid", value: "ok" },
      { type: "user_preference", value: "missing key" },
      { key: "foo", value: "missing type" },
      { type: "project_fact", key: "also_valid", value: "also ok" },
    ]));

    const result = await extractMemories([{ role: "user", content: "hi" }], { llm });
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("valid");
    expect(result[1].key).toBe("also_valid");
  });

  it("clamps confidence to 0-100 range", async () => {
    const llm = mockLLM(JSON.stringify([
      { type: "user_preference", key: "high", value: "v", confidence: 999, tags: [] },
      { type: "user_preference", key: "low", value: "v", confidence: -50, tags: [] },
    ]));

    const result = await extractMemories([{ role: "user", content: "hi" }], { llm });
    expect(result[0].confidence).toBe(100);
    expect(result[1].confidence).toBe(0);
  });

  it("filters out system messages from conversation", async () => {
    const llm = mockLLM(JSON.stringify([]));
    const result = await extractMemories(
      [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "hello" },
      ],
      { llm },
    );
    expect(result).toEqual([]);
  });

  it("handles empty messages array", async () => {
    const llm = mockLLM(JSON.stringify([]));
    const result = await extractMemories([], { llm });
    expect(result).toEqual([]);
  });
});

describe("extractEpochSummary", () => {
  it("returns LLM summary text", async () => {
    const llm = mockLLM("User asked about Python and got an answer");
    const result = await extractEpochSummary(
      [{ role: "user", content: "Tell me about Python" }],
      { llm },
    );
    expect(result).toBe("User asked about Python and got an answer");
  });

  it("returns fallback text on empty LLM output", async () => {
    const llm = mockLLM("");
    const result = await extractEpochSummary(
      [{ role: "user", content: "hi" }],
      { llm },
    );
    expect(result).toBe("(LLM summary unavailable)");
  });

  it("formats messages with role labels", async () => {
    let receivedMessages: string[] = [];
    const llm: LLMAdapter = {
      async *complete(messages: SessionMessage[]) {
        receivedMessages = messages.map((m) => `${m.role}: ${m.content}`);
        yield { content: "summary" };
      },
    };

    await extractEpochSummary(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        { role: "system", content: "be helpful" },
      ],
      { llm },
    );

    const userLine = receivedMessages.find((m) => m.includes("User: hello"));
    const assistantLine = receivedMessages.find((m) => m.includes("Assistant: hi there"));
    const systemLine = receivedMessages.find((m) => m.includes("System: be helpful"));
    expect(userLine).toBeTruthy();
    expect(assistantLine).toBeTruthy();
    expect(systemLine).toBeTruthy();
  });
});
