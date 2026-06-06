import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig = vi.fn();
let mockFetch: any;

vi.mock("../../src/config/index.js", () => ({
  getConfig: () => mockConfig(),
}));

import { ExaProvider, ParallelProvider, performWebSearch } from "../../src/tools/websearch.js";
import type { SearchProvider, SearchResultItem } from "../../src/tools/base-tool.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.mockReturnValue({ EXA_API_KEY: "exa-key-123", PARALLEL_API_KEY: "par-key-456" });
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

function mockFetchResponse(data: unknown) {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve(data),
  });
}

describe("ExaProvider", () => {
  it("sends X-Api-Key header and returns parsed results", async () => {
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "exa-1",
      result: {
        content: [
          { title: "Exa Result", url: "https://exa.ai", content: "Exa content" },
        ],
      },
    });

    const provider = new ExaProvider();
    const results = await provider.search("test query", { numResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Exa Result");
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe("https://mcp.exa.ai/mcp");
    expect(callArgs[1].headers["X-Api-Key"]).toBe("exa-key-123");
  });

  it("throws on MCP error response", async () => {
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "exa-1",
      error: { code: -32000, message: "Rate limited" },
    });

    const provider = new ExaProvider();
    await expect(provider.search("test")).rejects.toThrow("Rate limited");
  });

  it("works without API key", async () => {
    mockConfig.mockReturnValue({});
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "exa-1",
      result: { content: [] },
    });

    const provider = new ExaProvider();
    const results = await provider.search("test");
    expect(results).toEqual([]);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Api-Key"]).toBeUndefined();
  });

  it("handles array result format", async () => {
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "exa-1",
      result: [
        { title: "A", url: "https://a.com", content: "Content A" },
      ],
    });

    const provider = new ExaProvider();
    const results = await provider.search("test");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://a.com");
  });
});

describe("ParallelProvider", () => {
  it("sends Authorization header and returns parsed results", async () => {
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "parallel-1",
      result: {
        content: [
          { title: "Parallel Result", url: "https://parallel.ai", content: "Parallel content" },
        ],
      },
    });

    const provider = new ParallelProvider();
    const results = await provider.search("test query", { numResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Parallel Result");
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe("https://search-mcp.parallel.ai/mcp");
    expect(callArgs[1].headers["Authorization"]).toBe("Bearer par-key-456");
  });

  it("throws on MCP error", async () => {
    mockFetchResponse({
      jsonrpc: "2.0",
      id: "parallel-1",
      error: { code: -32000, message: "Unauthorized" },
    });

    const provider = new ParallelProvider();
    await expect(provider.search("test")).rejects.toThrow("Unauthorized");
  });
});

describe("performWebSearch", () => {
  it("delegates to provided provider", async () => {
    const mockProvider: SearchProvider = {
      name: "exa",
      search: vi.fn().mockResolvedValue([{ title: "T", url: "https://t.com", content: "C" }]),
    };

    const results = await performWebSearch(mockProvider, "query", 3);
    expect(results).toHaveLength(1);
    expect(mockProvider.search).toHaveBeenCalledWith("query", { numResults: 3 }, undefined);
  });
});
