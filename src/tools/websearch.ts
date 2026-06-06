import type { SearchProvider, SearchResultItem, SearchOptions } from "./base-tool.js";
import { getConfig } from "../config/index.js";

interface MCPJsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPJsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_MCP_URL = "https://search-mcp.parallel.ai/mcp";

function parseMcpSearchResults(result: unknown): SearchResultItem[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as Record<string, unknown>).content;
  if (Array.isArray(content)) {
    return content as SearchResultItem[];
  }
  if (Array.isArray(result)) {
    return (result as Record<string, unknown>[]).map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      url: typeof r.url === "string" ? r.url : "",
      content: typeof r.content === "string" ? r.content : typeof r.snippet === "string" ? r.snippet : "",
      score: r.score as number | undefined,
      publishedDate: r.publishedDate as string | undefined,
    }));
  }
  return [];
}

async function mcpSearch(
  url: string,
  method: string,
  params: Record<string, unknown>,
  apiKeyHeader?: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const body: MCPJsonRpcRequest = {
    jsonrpc: "2.0",
    id: `${method}-${Date.now()}`,
    method,
    params,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKeyHeader) {
    headers.Authorization = `Bearer ${apiKeyHeader}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as MCPJsonRpcResponse;
  if (json.error) throw new Error(`MCP error (${method}): ${json.error.message}`);
  return parseMcpSearchResults(json.result);
}

export class ExaProvider implements SearchProvider {
  readonly name = "exa";

  async search(query: string, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const config = getConfig();
    const key = config.EXA_API_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers["X-Api-Key"] = key;
    const body: MCPJsonRpcRequest = {
      jsonrpc: "2.0",
      id: `exa-${Date.now()}`,
      method: "web_search",
      params: { query, numResults: options?.numResults ?? 8 },
    };
    const res = await fetch(EXA_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const json = (await res.json()) as MCPJsonRpcResponse;
    if (json.error) throw new Error(`Exa MCP error: ${json.error.message}`);
    return parseMcpSearchResults(json.result);
  }
}

export class ParallelProvider implements SearchProvider {
  readonly name = "parallel";

  async search(query: string, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const config = getConfig();
    const key = config.PARALLEL_API_KEY;
    return mcpSearch(PARALLEL_MCP_URL, "web_search", { query, numResults: options?.numResults ?? 8 }, key, signal);
  }
}

export function performWebSearch(
  provider: SearchProvider,
  query: string,
  numResults = 8,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  return provider.search(query, { numResults }, signal);
}
