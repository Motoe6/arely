import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLlmCore = vi.hoisted(() => ({
  createModel: vi.fn(() => ({ id: "test", name: "test", api: "test" })),
  ProviderBridgeAdapter: class {
    async *complete() {
      yield { content: "mock response" };
    }
  },
  registerBuiltInApiProviders: vi.fn(),
}));

const mockPersistence = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  createInMemoryDb: vi.fn(),
  pushSchema: vi.fn(),
}));

vi.mock("@arely/persistence", () => mockPersistence);
vi.mock("@arely/llm-core", () => mockLlmCore);

import { Arely } from "@arely/sdk";

describe("Arely", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an instance with default config", () => {
    const arely = new Arely();
    expect(arely).toBeInstanceOf(Arely);
  });

  it("accepts custom config", () => {
    const arely = new Arely({ provider: "openai", model: "gpt-4" });
    expect(arely).toBeInstanceOf(Arely);
  });

  it("merges env config with provided config", () => {
    process.env["ARELY_PROVIDER"] = "anthropic";
    const arely = new Arely({ model: "claude-3" });
    expect(arely).toBeInstanceOf(Arely);
    delete process.env["ARELY_PROVIDER"];
  });

  it("provides a memory property", () => {
    const arely = new Arely();
    expect(arely.memory).toBeDefined();
  });

  it("chat returns a string", async () => {
    const arely = new Arely();
    const result = await arely.chat("Hello");
    expect(typeof result).toBe("string");
    expect(result).toBe("mock response");
  });

  it("close does not throw", async () => {
    const arely = new Arely();
    await expect(arely.close()).resolves.toBeUndefined();
  });
});
