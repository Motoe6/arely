import { describe, it, expect } from "vitest";
import { createSearchProvider } from "@arelyos/engine/tools/provider-factory.js";
import { ExaProvider, ParallelProvider } from "@arelyos/engine/tools/websearch.js";

describe("createSearchProvider", () => {
  it("returns ExaProvider for exa config", () => {
    const provider = createSearchProvider({ ARELY_WEBSEARCH_PROVIDER: "exa" } as any);
    expect(provider).toBeInstanceOf(ExaProvider);
  });

  it("returns ParallelProvider for parallel config", () => {
    const provider = createSearchProvider({ ARELY_WEBSEARCH_PROVIDER: "parallel" } as any);
    expect(provider).toBeInstanceOf(ParallelProvider);
  });
});
