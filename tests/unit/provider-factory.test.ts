import { describe, it, expect } from "vitest";
import { createSearchProvider } from "../../src/tools/provider-factory.js";
import { ExaProvider, ParallelProvider } from "../../src/tools/websearch.js";

describe("createSearchProvider", () => {
  it("returns ExaProvider for exa config", () => {
    const provider = createSearchProvider({ OPENCODE_WEBSEARCH_PROVIDER: "exa" } as any);
    expect(provider).toBeInstanceOf(ExaProvider);
  });

  it("returns ParallelProvider for parallel config", () => {
    const provider = createSearchProvider({ OPENCODE_WEBSEARCH_PROVIDER: "parallel" } as any);
    expect(provider).toBeInstanceOf(ParallelProvider);
  });
});
