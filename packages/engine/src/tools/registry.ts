import { ulid } from "ulid";
import type { SSEBus } from "../server/sse.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { SearchProvider, ToolContext, ToolResult } from "./base-tool.js";
import type { Tool } from "./base-tool.js";
import { performWebSearch } from "./websearch.js";
import { metrics } from "../metrics.js";

export type { Tool };
import { performWebFetch } from "./webfetch.js";
import { RedditProvider, formatRedditPosts } from "./reddit.js";
import { fetchRSS, formatRSSEntries } from "./rss.js";
import { agentMemoryGet, agentMemorySet } from "./memory.js";
import { createToolCall, updateToolCallStatus } from "../persistence/tool-call-store.js";
import { getConfig } from "../config/index.js";
import { TimeoutError, CancelledError, withTimeout } from "./errors.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { withRetry } from "./retry.js";
import { RateLimiter } from "./rate-limiter.js";
import type {
  ToolCallPendingEvent,
  ToolCallStartedEvent,
  ToolCallCompletedEvent,
  ToolCallFailedEvent,
  ToolCallTimedOutEvent,
  ToolCallCancelledEvent,
} from "../types/events.js";

export { TimeoutError, CancelledError };

export interface RegistryOptions {
  sse: SSEBus;
  sessionId: string;
  gate: PermissionGate;
  searchProvider: SearchProvider;
  agentId?: string;
}

export function createToolRegistry(opts: RegistryOptions): Map<string, Tool> {
  const config = getConfig();

  const breaker = new CircuitBreaker(
    {
      threshold: config.CIRCUIT_BREAKER_THRESHOLD,
      resetTimeout: config.CIRCUIT_BREAKER_RESET_MS,
      enabled: config.CIRCUIT_BREAKER_ENABLED,
    },
    (event) => { opts.sse.emit(opts.sessionId, event); },
  );

  const rateLimiter = new RateLimiter(
    {
      maxRequests: config.RATE_LIMIT_DEFAULT_MAX,
      windowMs: config.RATE_LIMIT_DEFAULT_WINDOW_MS,
      enabled: config.RATE_LIMIT_ENABLED,
    },
    (event) => { opts.sse.emit(opts.sessionId, event); },
  );

  const registry = new Map<string, Tool>();

  async function executeWithLifecycle(
    toolName: string,
    args: Record<string, unknown>,
    executor: (ctx: ToolContext) => Promise<ToolResult>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    await rateLimiter.allow(toolName, opts.sessionId);

    const allowed = await opts.gate.check(toolName, args);
    if (!allowed) {
      return { content: `${toolName} declined by user.` };
    }

    const record = createToolCall({
      sessionId: opts.sessionId,
      toolName,
      args,
      permissionMode: "ask",
    });
    const toolCallId = record.id;

    const pendingEvent: ToolCallPendingEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "tool_call_pending",
      toolCallId,
      toolName,
      args,
      correlationId: toolCallId,
    };
    opts.sse.emit(opts.sessionId, pendingEvent);

    updateToolCallStatus(toolCallId, "running");
    const startedEvent: ToolCallStartedEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "tool_call_started",
      toolCallId,
      toolName,
      args,
      correlationId: toolCallId,
    };
    opts.sse.emit(opts.sessionId, startedEvent);

    const ctx: ToolContext = { sessionId: opts.sessionId, agentId: opts.agentId, signal };
    const timeoutMs = config.TOOL_TIMEOUT_MS;

    try {
      const result = await breaker.call(toolName, async () => {
        return await withRetry(
          () => withTimeout(executor(ctx), timeoutMs),
          {
            maxAttempts: config.RETRY_MAX_ATTEMPTS,
            baseDelayMs: config.RETRY_BASE_DELAY_MS,
            maxDelayMs: config.RETRY_MAX_DELAY_MS,
            enabled: config.RETRY_ENABLED,
          },
          (event) => { opts.sse.emit(opts.sessionId, event); },
          { toolName, correlationId: toolCallId },
          signal,
        );
      }, toolCallId);

      const endTime = Date.now();
      const durationMs = endTime - startedEvent.timestamp;
      updateToolCallStatus(toolCallId, "completed", { result: result.content });
      const completedEvent: ToolCallCompletedEvent = {
        id: ulid(),
        version: 1,
        timestamp: endTime,
        type: "tool_call_completed",
        toolCallId,
        result: result.content,
        durationMs,
        correlationId: toolCallId,
      };
      opts.sse.emit(opts.sessionId, completedEvent);
      return result;
    } catch (err) {
      const endTime = Date.now();
      const durationMs = endTime - startedEvent.timestamp;
      if (err instanceof TimeoutError) {
        updateToolCallStatus(toolCallId, "timed_out", { error: err.message });
        const timedOutEvent: ToolCallTimedOutEvent = {
          id: ulid(),
          version: 1,
          timestamp: endTime,
          type: "tool_call_timed_out",
          toolCallId,
          durationMs,
          correlationId: toolCallId,
        };
        opts.sse.emit(opts.sessionId, timedOutEvent);
      } else if (err instanceof CancelledError) {
        updateToolCallStatus(toolCallId, "cancelled");
        const cancelledEvent: ToolCallCancelledEvent = {
          id: ulid(),
          version: 1,
          timestamp: endTime,
          type: "tool_call_cancelled",
          toolCallId,
          correlationId: toolCallId,
        };
        opts.sse.emit(opts.sessionId, cancelledEvent);
      } else {
        metrics.increment("tool_failures_total", { tool: toolName, error: String(err).slice(0, 80) });
        updateToolCallStatus(toolCallId, "failed", { error: String(err) });
        const failedEvent: ToolCallFailedEvent = {
          id: ulid(),
          version: 1,
          timestamp: endTime,
          type: "tool_call_failed",
          toolCallId,
          error: String(err),
          durationMs,
          correlationId: toolCallId,
        };
        opts.sse.emit(opts.sessionId, failedEvent);
      }
      throw err;
    }
  }

  registry.set("websearch", {
    name: "websearch",
    description: "Search the web using Exa or Parallel search providers",
    execute(args, ctx) {
      return executeWithLifecycle("websearch", args, async (_ctx) => {
        const query = typeof args.query === "string" ? args.query : "";
        const numResults = typeof args.numResults === "number" ? args.numResults : 8;
        const results = await performWebSearch(opts.searchProvider, query, numResults);
        const formatted = formatSearchResults(results);
        return { content: formatted, metadata: { provider: opts.searchProvider.name } };
      }, ctx.signal);
    },
  });

  registry.set("webfetch", {
    name: "webfetch",
    description: "Fetch a URL and convert it to markdown",
    execute(args, ctx) {
      return executeWithLifecycle("webfetch", args, async (_ctx) => {
        const url = typeof args.url === "string" ? args.url : "";
        const result = await performWebFetch(url);
        const formatted = formatFetchResult(result);
        return { content: formatted };
      }, ctx.signal);
    },
  });

  registry.set("reddit_hot", {
    name: "reddit_hot",
    description: "Get hot/trending posts from a subreddit. Args: { subreddit: string, limit?: number }",
    execute(args, ctx) {
      return executeWithLifecycle("reddit_hot", args, async (_ctx) => {
        const reddit = new RedditProvider();
        const subreddit = typeof args.subreddit === "string" ? args.subreddit : "";
        const limit = typeof args.limit === "number" ? args.limit : 25;
        if (!subreddit) return { content: "Error: subreddit is required." };
        const posts = await reddit.hot(subreddit, limit);
        return { content: formatRedditPosts(posts, subreddit) };
      }, ctx.signal);
    },
  });

  registry.set("reddit_search", {
    name: "reddit_search",
    description: "Search Reddit posts by keyword within a subreddit or globally. Args: { query: string, subreddit?: string, limit?: number }",
    execute(args, ctx) {
      return executeWithLifecycle("reddit_search", args, async (_ctx) => {
        const reddit = new RedditProvider();
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) return { content: "Error: query is required." };
        const limit = typeof args.limit === "number" ? args.limit : 25;
        const subreddit = typeof args.subreddit === "string" ? args.subreddit : undefined;
        if (subreddit) {
          const posts = await reddit.search(subreddit, query, limit);
          return { content: formatRedditPosts(posts, subreddit) };
        }
        const results = await reddit.globalSearch(query, limit);
        if (results.length === 0) return { content: "No posts found." };
        const parts = results.map((r) => formatRedditPosts(r.posts, r.subreddit));
        return { content: parts.join("\n\n") };
      }, ctx.signal);
    },
  });

  registry.set("rss_fetch", {
    name: "rss_fetch",
    description: "Fetch and parse an RSS/Atom feed. Args: { url: string, limit?: number }",
    execute(args, ctx) {
      return executeWithLifecycle("rss_fetch", args, async (_ctx) => {
        const url = typeof args.url === "string" ? args.url : "";
        if (!url) return { content: "Error: url is required." };
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const feed = await fetchRSS(url, limit);
        return { content: formatRSSEntries(feed) };
      }, ctx.signal);
    },
  });

  registry.set("memory_get", {
    name: "memory_get",
    description: "Read a value from persistent memory by key. Scoped to the current agent if running autonomously. Args: { key: string }",
    execute(args, ctx) {
      return executeWithLifecycle("memory_get", args, (_ctx) => {
        const key = typeof args.key === "string" ? args.key : "";
        if (!key) return Promise.resolve({ content: "Error: key is required." });
        const scope = ctx.agentId ?? ctx.sessionId;
        const result = agentMemoryGet(scope, key);
        return Promise.resolve({ content: result ?? `No value found for key "${key}".` });
      }, ctx.signal);
    },
  });

  registry.set("memory_set", {
    name: "memory_set",
    description: "Store a value in persistent memory. Scoped to the current agent if running autonomously. Args: { key: string, value: string }",
    execute(args, ctx) {
      return executeWithLifecycle("memory_set", args, (_ctx) => {
        const key = typeof args.key === "string" ? args.key : "";
        const value = typeof args.value === "string" ? args.value : "";
        if (!key) return Promise.resolve({ content: "Error: key is required." });
        if (!value) return Promise.resolve({ content: "Error: value is required." });
        const scope = ctx.agentId ?? ctx.sessionId;
        agentMemorySet(scope, key, value);
        return Promise.resolve({ content: `Memory updated: ${key} = ${value}` });
      }, ctx.signal);
    },
  });

  return registry;
}

function formatSearchResults(results: { title: string; url: string; content: string; publishedDate?: string }[]): string {
  if (results.length === 0) return "No results found.";
  const lines = results.map((r, i) => {
    const date = r.publishedDate ? ` (${r.publishedDate})` : "";
    return `[${i + 1}] ${r.title}${date}\n    URL: ${r.url}\n    ${r.content.slice(0, 500)}`;
  });
  return lines.join("\n\n");
}

function formatFetchResult(result: { url: string; title: string; content: string; images?: string[] }): string {
  let out = `# ${result.title}\n\nSource: ${result.url}\n\n${result.content.slice(0, 8000)}`;
  out += `\n\n---\nFetched ${result.content.length} chars from ${result.url}`;
  if (result.images && result.images.length > 0) {
    out += `\n\nImages: ${result.images.join(", ")}`;
  }
  return out;
}
