import { describe, it, expect, vi } from "vitest";

const mockLlmCore = vi.hoisted(() => ({
  createModel: vi.fn(),
  ProviderBridgeAdapter: class {
    async *complete() {
      yield { content: "Analysis complete" };
    }
  },
  registerBuiltInApiProviders: vi.fn(),
}));

vi.mock("@arely/llm-core", () => mockLlmCore);

import { AgentSession } from "@arely/sdk";
import type { ArelyTool } from "@arely/sdk";

describe("AgentSession", () => {
  it("runs agent loop and returns content", async () => {
    const agent = new AgentSession(mockLlmCore.ProviderBridgeAdapter as any);
    const result = await agent.run("Analyze this");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("turns");
  });

  it("accepts custom tools", async () => {
    const agent = new AgentSession(mockLlmCore.ProviderBridgeAdapter as any);
    const tools: ArelyTool[] = [
      { name: "read_file", description: "Read a file", execute: async () => "file content" },
    ];
    const result = await agent.run("Read file", { tools });
    expect(result.content).toBeDefined();
  });

  it("accepts maxIterations option", async () => {
    const agent = new AgentSession(mockLlmCore.ProviderBridgeAdapter as any);
    const result = await agent.run("Do work", { maxIterations: 5 });
    expect(result.content).toBeDefined();
  });
});
