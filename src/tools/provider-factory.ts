import type { Config } from "../config/index.js";
import { ExaProvider, ParallelProvider } from "./websearch.js";
import type { SearchProvider } from "./base-tool.js";

function assertNever(value: never): never {
  throw new Error(`Unreachable provider: ${value}`);
}

export function createSearchProvider(config: Config): SearchProvider {
  switch (config.OPENCODE_WEBSEARCH_PROVIDER) {
    case "exa":
      return new ExaProvider();
    case "parallel":
      return new ParallelProvider();
    default:
      return assertNever(config.OPENCODE_WEBSEARCH_PROVIDER);
  }
}
