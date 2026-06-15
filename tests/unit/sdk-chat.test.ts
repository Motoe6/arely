import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "@arely/sdk";

const makeMockLlm = (responses: string[]) => ({
  complete: vi.fn().mockImplementation(async function* () {
    for (const r of responses) {
      yield { content: r };
    }
  }),
});

describe("ChatSession", () => {
  it("sends a message and returns response", async () => {
    const llm = makeMockLlm(["Hello world"]);
    const session = new ChatSession(llm as any);
    const result = await session.send("Hi");
    expect(result).toBe("Hello world");
  });

  it("accumulates conversation history", async () => {
    const llm = makeMockLlm(["First response", "Second response"]);
    const session = new ChatSession(llm as any);
    await session.send("First message");
    const messages = session.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("calls onDelta callback for streaming", async () => {
    const llm = makeMockLlm(["Hello", " world"]);
    const session = new ChatSession(llm as any);
    const deltas: string[] = [];
    await session.send("Hi", { onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual(["Hello", " world"]);
  });

  it("supports system prompt in constructor", async () => {
    const mockComplete = vi.fn().mockImplementation(async function* () {
      yield { content: "response" };
    });
    const llm = { complete: mockComplete };
    const session = new ChatSession(llm as any, "You are a helpful assistant.");
    await session.send("Hi");
    expect(session.getMessages()[0].content).toBe("You are a helpful assistant.");
    expect(session.getMessages()[0].role).toBe("system");
  });

  it("clears history on reset", async () => {
    const llm = makeMockLlm(["response"]);
    const session = new ChatSession(llm as any);
    await session.send("Hi");
    session.reset();
    expect(session.getMessages()).toHaveLength(0);
  });
});
