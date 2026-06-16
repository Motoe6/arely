# Arely Agent — Build Notes

## Goal

Build a TypeScript AI coding agent (open-source clone of Claude Code) with:
- **M1 (done)**: Config, SSE transport, routing, SSEBus, SQLite persistence (7 stores), DB migrations, basic event types
- **M2 (done)**: Tool system (search, fetch), permission gate, tool lifecycle with SSE events, provider factory, URL validation, timeouts
- **M3 (done)**: Circuit breaker (Closed→Open→Half-Open), retry framework (exponential backoff), rate limiting (sliding window), parallel execution
- **M4+ (next)**: Agent loop, LLM integration, advanced execution control

## Architecture

```
src/
├── config/           # Zod-based config (env vars)
├── permissions/      # PermissionGate (deny/allow/ask modes)
│   └── gate.ts       # Persist + audit + cache; explicit timeout auto-deny
├── persistence/      # SQLite + Drizzle ORM (7 stores)
│   ├── schema.ts     # Drizzle table definitions
│   ├── database.ts   # Better-sqlite3 wrapper
│   ├── migrate.ts    # Migration runner
│   └── stores/       # tool-call, permission, approval-cache, audit, session, event, config stores
├── server/           # Session management
├── tools/            # Tool system (M2) + Resilience (M3)
│   ├── base-tool.ts  # Tool, ToolContext, ToolResult, SearchProvider interfaces
│   ├── websearch.ts  # ExaProvider + ParallelProvider (API key auth)
│   ├── webfetch.ts   # URL validation + SSRF protection + HTML→Markdown
│   ├── provider-factory.ts  # Exhaustive switch + assertNever
│   ├── errors.ts     # Shared error classes (TimeoutError, CancelledError, CircuitBreakerOpenError)
│   ├── circuit-breaker.ts  # State machine: Closed→Open→Half-Open; per-tool isolation
│   ├── retry.ts      # withRetry() — exponential backoff + jitter; non-retryable error classification
│   ├── rate-limiter.ts  # Sliding window per (toolName, sessionId); SSE event on limit
│   ├── parallel-executor.ts  # Queue-based executor with concurrency limit + AbortSignal
│   └── registry.ts   # Tool lifecycle + pipeline integration (rate limiter → gate → CB → retry → timeout)
├── transport/        # HTTP server + SSE routing + SSEBus (EventEmitter)
└── types/            # TypeScript types + event definitions
    ├── events.ts     # AgentEvent union (additive only)
    └── ...
```

## M2 Delivery Summary

### Files Created / Rewritten
| File | Status | Description |
|------|--------|-------------|
| `src/tools/base-tool.ts` | NEW | Tool, ToolContext, ToolResult, SearchProvider, SearchResultItem interfaces |
| `src/tools/websearch.ts` | REWRITE | ExaProvider + ParallelProvider classes; `X-Api-Key` / `Authorization: Bearer` headers |
| `src/tools/provider-factory.ts` | NEW | `createSearchProvider()` with exhaustive switch + assertNever |
| `src/tools/webfetch.ts` | REWRITE | URL scheme validation (http/https), private IP rejection (localhost, 10.*, 172.16-31.*, 192.168.*), config UA |
| `src/tools/registry.ts` | REWRITE | Tool interface, `executeWithLifecycle()`, SSE lifecycle events, `withTimeout()` |
| `src/permissions/gate.ts` | REWRITE | Config-driven modes (deny/allow/ask), approval_cache integration, persist+audit, PERMISSION_TIMEOUT_MS auto-deny |
| `src/server/session.ts` | UPDATE | Adapted to new Tool and PermissionGate 2-arg APIs |

### Test Coverage (12 files, 95 tests)
| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `tests/unit/gate.test.ts` | 8 | deny/allow/ask modes, cache hit, prompt+resolve granted/denied, timeout |
| `tests/unit/registry.test.ts` | 7 | websearch success/denied/error, webfetch success/error, TimeoutError/CancelledError |
| `tests/unit/websearch.test.ts` | 7 | ExaProvider API key header, ParallelProvider Bearer, MCP error, empty key |
| `tests/unit/webfetch.test.ts` | 19 | http/https allowed, file/ftp/data/javascript blocked, localhost/10/172/192 blocked, HTML→markdown |
| `tests/unit/provider-factory.test.ts` | 2 | Exa + Parallel provider selection |
| `tests/integration/tool-lifecycle.test.ts` | 2 | Full lifecycle with real DB (pending→started→completed events + tool_calls table) |

### Quality Metrics
- **Build**: `tsc --noEmit` — 0 errors
- **Lint**: `eslint src/tools/*.ts src/permissions/gate.ts` — 0 errors
- **Tests**: 95/95 pass
- **Coverage**: 92.85% stmts / 81.15% branch / 94.11% funcs / 93.83% lines (all ≥80%)

## Key Decisions

### Permission Gate
- "deny" mode → audit log + throw PermissionDeniedError
- "allow" mode → persist approval + audit log + return true (no cache)
- "ask" mode → check approval_cache → hit = audit + true | miss = prompt() via SSEBus → resolve() → persist + audit + cache
- Explicit PERMISSION_TIMEOUT_MS (from config, default 120s) → auto-deny + audit trail + permission_denied event

### Tool Lifecycle States
`pending → running → completed | failed | timed_out | cancelled`
- Each state transition emits a dedicated SSE event with `correlationId = toolCallId`
- `withTimeout()` wraps tool execution; rejects on TOOL_TIMEOUT_MS (from config, default 120s)

### Search Providers
- Exa: API key via `X-Api-Key` header; JSON-RPC endpoint from config `EXA_MCP_URL`
- Parallel: API key via `Authorization: Bearer` header; endpoint from config `PARALLEL_MCP_URL`
- Factory uses exhaustive `switch` + `assertNever` — adding a new provider enum without updating the factory causes a TypeScript compile error

### WebFetch
- Only `http:` and `https:` schemes allowed (blocks `file:`, `ftp:`, `data:`, `javascript:`)
- Rejects private IP ranges: localhost, 127.0.0.1, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- HTML converted to Markdown via TurndownService; extracts `<title>` and up to 5 `<img>` URLs
- User-Agent: `ArelyAgent/1.0`

### Persistence Guarantees
- Events persisted BEFORE SSE emit (SSEBus.emit() calls persistEvent() first)
- Tool calls, permission approvals, and audit logs all written synchronously

### Config
- `TOOL_TIMEOUT_MS` (default 120000) — max execution time per tool call
- `PERMISSION_TIMEOUT_MS` (default 120000) — max wait for user permission approval
- `CIRCUIT_BREAKER_ENABLED` (default true), `CIRCUIT_BREAKER_THRESHOLD` (default 5), `CIRCUIT_BREAKER_RESET_MS` (default 30000)
- `RETRY_ENABLED` (default true), `RETRY_MAX_ATTEMPTS` (default 3), `RETRY_BASE_DELAY_MS` (default 1000), `RETRY_MAX_DELAY_MS` (default 30000)
- `RATE_LIMIT_ENABLED` (default false), `RATE_LIMIT_DEFAULT_MAX` (default 30), `RATE_LIMIT_DEFAULT_WINDOW_MS` (default 60000)
- All read via `getConfig()` at runtime

## M3 Delivery Summary

### Files Created
| File | Description |
|------|-------------|
| `src/tools/errors.ts` | Shared error classes: TimeoutError, CancelledError, CircuitBreakerOpenError, withTimeout() |
| `src/tools/circuit-breaker.ts` | CircuitBreaker: state machine (Closed→Open→Half-Open), per-tool isolation, in-memory only |
| `src/tools/retry.ts` | withRetry(): exponential backoff + jitter, non-retryable error classification (TimeoutError, CancelledError, CircuitBreakerOpenError) |
| `src/tools/rate-limiter.ts` | RateLimiter: sliding window per (toolName, sessionId), SSE rate_limit_exceeded event |
| `src/tools/parallel-executor.ts` | ParallelExecutor: queue-based, concurrency limit, AbortSignal, withTimeout support |
| `tests/unit/circuit-breaker.test.ts` | 9 tests: state machine, threshold, reset, half-open probe, per-tool isolation, disable, correlationId |
| `tests/unit/retry.test.ts` | 7 tests: first-attempt success, nth-attempt success, non-retryable (TimeoutError/CancelledError), max attempts, disable, correlationId |
| `tests/unit/rate-limiter.test.ts` | 7 tests: under/over limit, window reset, per-tool isolation, per-session isolation, disable, reset |
| `tests/unit/parallel-executor.test.ts` | 6 tests: execution order, concurrency limit, failure, pre-abort, timeout, empty |
| `tests/integration/resilience.test.ts` | 2 tests: circuit breaker open + fail-fast, per-tool breaker isolation with DB persistence |

### Files Modified
| File | Change |
|------|--------|
| `src/config/index.ts` | +10 Zod config keys for CB, retry, rate limiting |
| `src/types/events.ts` | +5 event types to AgentEvent union: circuit_opened, circuit_half_opened, circuit_closed, rate_limit_exceeded, retry_attempt |
| `src/tools/registry.ts` | executeWithLifecycle() closure inside createToolRegistry(); integrates rate limiter → gate → CB → retry → timeout pipeline |
| `tests/unit/registry.test.ts` | Updated config mock with M3 defaults |
| `tests/integration/tool-lifecycle.test.ts` | Updated config mock with M3 defaults |
| `vitest.config.ts` | Excluded base-tool.ts from coverage (pure interfaces) |

### Resolved Issues
- `withTimeout()` added `.catch(() => {})` on timeout promise to suppress Node unhandledRejection warnings from Promise.race
- CircuitBreakerOpenError extracted to errors.ts to break circular dependency between registry.ts → retry.ts → registry.ts
- RateLimiter.allow() de-async'd to avoid `@typescript-eslint/require-await` lint error

## Execution Guardrails (M3)
1. **Circuit Breaker in-memory only** — no persistence in M3; ADR for M5+ if needed
2. **Pipeline ordering enforced** — `RateLimiter → PermissionGate → CircuitBreaker → Retry → Timeout → Tool.execute()` — retry NEVER wraps PermissionGate
3. **correlationId on all resilience events** — when a toolCallId is available, it's passed as correlationId on circuit_opened/closed, retry_attempt events
4. **No retry on PermissionDenied/Cancelled** — PermissionDeniedError and CancelledError are classified as non-retryable upstream
5. **Per-tool circuit breaker isolation** — websearch open does not affect webfetch
6. **rate_limit_exceeded does not create tool_call** — rate limiter fires before createToolCall()
7. **All new events use eventVersion = 1**

## Execution Guardrails (M2 stored for reference)
1. **Events are additive only** — no existing event shapes modified
2. **Persist before SSE emit** — ensured by SSEBus.emit() design
3. **Timeouts from config** — not hardcoded
4. **Exhaustive factory** — compile-time safety via assertNever
5. **WebFetch URL + IP validation** — SSRF protection on every fetch

## Bugs Found & Fixed
- `vi.clearAllMocks()` calls `mockClear()` not `mockReset()` — persistent `mockReturnValue` leaked across tests; required explicit `mockReset()` after per-module mock tampering
- Gate's `prompt()` stored the resolve callback but never called the outer Promise `resolve()` — added `resolve(granted)`
- Integration tests needed a session row in the DB for FK constraints — added `createSession()`
- Multiple ESLint issues fixed: void expressions, unused vars, no-base-to-string, dot-notation, prefer-regexp-exec, array-type

## M4 Delivery Summary

### Files Created
| File | Description |
|------|-------------|
| `src/server/agent-loop.ts` | Extracted agent loop: LLM ↔ tool execution cycle; emits session_thinking, assistant_message_created, assistant_message_completed, tool_result_received, agent_loop_completed, agent_loop_failed |
| `src/llm/conversation.ts` | Conversation builder: loadConversation(), injectToolResult(), injectSystemPrompt() |
| `src/server/session-manager.ts` | Session lifecycle management: createSession(), getSession(), cancelSession() |
| `tests/unit/agent-loop.test.ts` | 9 tests: text-only, tool calls, unknown tool, tool error, LLM error, abort, max iterations, events, messages |
| `tests/unit/conversation.test.ts` | 7 tests: loadConversation, injectToolResult, injectSystemPrompt, token limit stub |
| `tests/unit/openaicompat.test.ts` | 7 tests: text content, tool calls, API error, empty body, text mode, native mode, request format |
| `tests/integration/agent-session.test.ts` | 6 tests: text-only session, tool calls, in-memory messages, abort, tool failure, max iterations |

### Files Modified
| File | Change |
|------|--------|
| `src/config/index.ts` | +3 Zod config keys: ARELY_MAX_ITERATIONS (default 20), ARELY_STREAMING (default true), ARELY_TOOL_MODE (default "native") |
| `src/types/events.ts` | +7 event types to AgentEvent union: session_thinking, assistant_message_created, assistant_message_stream_delta, assistant_message_completed, tool_result_received, agent_loop_completed, agent_loop_failed |
| `src/server/session.ts` | Delegates core loop to runAgentLoop(); persists session to DB on run(); emits session_started; uses config for max iterations |
| `src/transport/http-server.ts` | Accepts optional setupRoutes callback for adding routes externally |
| `src/index.ts` | Creates LLM adapter + session-manager; wires POST/GET/DELETE session routes |
| `src/persistence/session-store.ts` | createSession() accepts optional id parameter |
| `vitest.config.ts` | Added coverage for src/server/agent-loop.ts, src/server/session-manager.ts, src/llm/openaicompat.ts, src/llm/conversation.ts |

### Architecture Highlights
- **agent-loop.ts** is a pure function: `runAgentLoop(opts)` takes LLM, messages, tools map, emit function, config, signal → returns `{ content, turns }`. Fully testable without session state.
- **session.ts** slimmed down: constructor sets up gate, registry, tools; `run()` delegates to `runAgentLoop()` and manages session lifecycle.
- **Conversation builder** provides `loadConversation()` (DB→runtime), `injectToolResult()` (append result msg), `injectSystemPrompt()` (prepend if missing).
- **HTTP API**: `POST /api/sessions` creates and runs a session; `POST /api/sessions/:id/cancel` cancels it; `GET /api/sessions` lists sessions.
- **Session persistence**: `AgentSession.run()` calls `createSession()` with matching ID to satisfy FK constraints in tool_calls table.

### M4 Events (all eventVersion = 1)
| Event | Fields |
|-------|--------|
| `session_thinking` | sessionId |
| `assistant_message_created` | sessionId, messageId, content |
| `assistant_message_stream_delta` | sessionId, delta |
| `assistant_message_completed` | sessionId, messageId, content |
| `tool_result_received` | sessionId, toolCallId, toolName, result |
| `agent_loop_completed` | sessionId, turns |
| `agent_loop_failed` | sessionId, error, turns |

### Test Coverage (21 files, 155 tests)
| Area | Tests |
|------|-------|
| M4 new tests (agent-loop, conversation, openaicompat, agent-session) | 29 new |
| M3 tests (circuit-breaker, retry, rate-limiter, parallel-executor, resilience) | 31 |
| M2 tests (gate, registry, websearch, webfetch, provider-factory, tool-lifecycle, http-server) | 49 |
| M1 tests (config, stores, persistence, sse, router) | 46 |

### Quality Metrics
- **Build**: `tsc --noEmit` — 0 errors
- **Lint**: ESLint — 0 errors on M4-related files
- **Tests**: 155/155 pass (21 files, 0 failures)
- **Coverage**: 92.21% stmts / 84.01% branch / 90.97% funcs / 92.85% lines (all ≥80%)
  - agent-loop.ts: 100% stmts / 95% branch / 100% funcs — all tool call paths covered
  - conversation.ts: 100% all metrics
  - openaicompat.ts: 89.53% stmts / 82% branch / 100% funcs

### Key Decisions
- Agent loop extracted as pure async function (not class) for testability
- M4 events are additive (no existing event shapes modified)
- session-manager.ts is a thin wrapper around AgentSession instances
- Config keys ARELY_* prefix follows existing convention
- `ARELY_STREAMING` is defined but streaming support deferred to M5+
- `SessionMessage` deprecation kept for LLMAdapter interface compatibility
- session_store.createSession() accepts optional `id` param to align with AgentSession.id

### Resolved Issues
- Integration tests failed with FOREIGN KEY constraint because AgentSession.id didn't match DB session id — added `id` param to createSession()
- SessionMessage deprecation lint errors on agent-loop.ts, session.ts, conversation.ts — suppressed with eslint-disable (required for LLMAdapter compatibility)
- Agent-loop tests needed step-based LLM mock (responses per iteration, not all at once)
- OpenAI text mode adapter yields 2 results: raw content + cleaned content+toolCalls — test updated to expect both

## Execution Guardrails (M4)
1. **Events are additive only** — no existing event shapes modified
2. **agent-loop.ts is stateless** — all state passed via parameters; no internal mutable state
3. **Session persisted before tool execution** — `createSession()` called at start of `run()` to satisfy FK constraints
4. **Agent loop aborts on signal** — checked at start of each iteration
5. **Max iterations from config** — replaces hardcoded `10`
6. **Tool errors don't crash the loop** — caught per-tool-call, pushed as error message, loop continues
7. **Unknown tools handled gracefully** — error pushed as message, no hard crash

## M8.1 Delivery Summary — Runtime Core Hardening

### Goal
Replace ad-hoc body parsing, raw `createServer` calls, and manual shutdown with a composable middleware pipeline (requestId → requestContext → cors → auth → bodyParser → requestCounter → requestLogger → errorHandler), graceful drain with second-signal force exit, and AsyncLocalStorage per-request context.

### Files Created
| File | Description |
|------|-------------|
| `src/transport/request-context.ts` | AsyncLocalStorage wrapper for per-request context (requestId, startTime); `runWithContext()` / `getRequestContext()` |
| `src/transport/middleware.ts` | 8 middleware factories: requestId (ulid + x-request-id header), cors (configurable origin), auth (x-api-key), bodyParser (1MB limit, two-phase 413), requestCounter (decrement on close), requestLogger (res.end interception), errorHandler (try/catch chain), requestContext (AsyncLocalStorage) |

### Files Modified
| File | Change |
|------|--------|
| `src/transport/router.ts` | `use()` for middleware stack registration; `dispatch()` iterates chain then calls `matchRoute()`; `sendError()` unified JSON error response |
| `src/transport/http-server.ts` | Options-based `HttpServerOptions` signature (`sse`, `port?`, `middleware?`, `setupRoutes?`); registers built-in routes first then setupRoutes |
| `src/config/index.ts` | +4 env vars: `HTTP_BODY_LIMIT_BYTES` (default 1MB), `HTTP_API_AUTH_ENABLED` (default false), `HTTP_CORS_ORIGIN` (default *), `HTTP_REQUEST_TIMEOUT_MS` (default 30000) |
| `src/server/shutdown.ts` | `startDrain()` — polls `getActiveRequests` every 100ms, closes DB, emits completed event; `isDraining()` flag; `forceExit()` for second signal |
| `src/index.ts` | Exclusion lists (authExclude, logExclude, bodyExclude); middleware array wired; 5× manual body parse (`req.on("data")` concat) replaced with `req.body`; shutdown handler uses `startDrain` + second-signal `forceExit` |
| `tests/unit/http-server.test.ts` | Updated `createHttpServer()` calls to new `{ sse, port: 0 }` signature |
| `tests/unit/router.test.ts` | Error assertion updated to match new `errorHandler` format |

### Key Design
- **Middleware order enforced at runtime**: requestId → requestContext (AsyncLocalStorage) → cors → auth → bodyParser → requestCounter (decrement on close, not after response) → requestLogger (intercepts res.end for timing) → errorHandler wraps all
- **Static exclusion lists per middleware**: `authExclude` skips /health, /ready, /metrics, /deps, /api/sse; `logExclude` skips /health, /metrics; `bodyExclude` skips the same set + /api/sse/replay
- **bodyParser two-phase enforcement**: Content-Length header check (early 413) + mid-stream byte counting with `req.destroy()` on overflow (second 413)
- **Shutdown**: first signal → `startDrain()` polls active requests → closes DB + emits drain event; second signal → `process.exit(1)` immediately (matches Docker SIGTERM→SIGKILL)
- **No new npm dependencies**: all middleware built from `node:http` primitives; AsyncLocalStorage from `node:async_hooks`

## Fase 1 — Root Build Stability

### Goal
Root `tsc -b` passes with 0 errors. Before this build, the project had ~60+ TypeScript errors across 15 files due to stale builds, Drizzle ORM duplicate instances, and Zod 4 API incompatibilities.

### Fixed Issues

| Issue | Root Cause | Fix | Files Changed |
|-------|-----------|-----|---------------|
| Drizzle `where()` TS2740 | Nested `drizzle-orm` copies → structurally incompatible `SQL` types | Removed `drizzle-orm` from workspace `package.json` files (kept only in root) → `npm install` | `packages/engine/package.json`, `packages/persistence/package.json` |
| Drizzle path mapping | `paths` in root tsconfig don't work with project references (each child compiles independently) | Discarded path mapping approach; single npm copy is definitive | root `tsconfig.json` |
| `.npmrc` | Incorrect pnpm config for npm project | Deleted `.npmrc` | `.npmrc` |
| `memory-store.ts` `query` param name collision | `query` parameter name shadowed `let query: any` variable (TS2300, TS2339, TS7006) | Renamed param `query` → `q`; added explicit `MemoryRecord[]` and `(r: MemoryRecord)` types | `packages/persistence/src/memory-store.ts` |
| `memory/src/index.ts` renamed type | `DecisionOutcomeUpdatedCallback` was renamed to `OutcomeUpdatedCallback` (TS2724) | Updated import to use new name | `packages/memory/src/index.ts` |
| `model-performance-service.ts` Drizzle chain | Missing `: any` on `let query` for `.where()` (TS2740) | Added `: any` annotation | `packages/memory/src/model-performance-service.ts` |
| `planning-service.ts` missing imports | `GoalPlanStatus` and `MilestoneStatus` not imported (TS2304) | Added imports from `@arelyos/persistence` | `packages/memory/src/planning-service.ts` |
| `evolution-routes.ts` missing import | `TemplateMetricsService` not imported (TS2304) | Added `import type` | `packages/engine/src/compiler/evolution-routes.ts` |
| `node-package-loader.ts` return type | `validateManifest` returned `PackageManifestV1` but signature said `PackageManifest` (TS2552); `setTemplateRegistry` param type mismatch (TS2345) | Updated return type to `PackageManifestV1`; added `import type { TemplateSource }`; updated param to `source?: TemplateSource` | `packages/engine/src/compiler/node-package-loader.ts` |
| `package-routes.ts` duplicate `version` | Two `version: record.version` in same object (TS1117) + collision with `BaseEvent.version: 1` (TS2322) | Removed duplicates; renamed event field from `version` to `pkgVersion` | `packages/engine/src/compiler/package-routes.ts` |
| `evolution-engine.ts` Zod 4 API | `z.record(z.unknown())` → Zod 4 requires explicit key schema (TS2554) | Changed to `z.record(z.string(), z.unknown())` | `packages/engine/src/templates/evolution-engine.ts` |
| `template-routes.ts` nullish chain | TS2871 on long `??` chain | Split into intermediate `const` variables (`bodyName`, `wfName`) | `packages/engine/src/templates/template-routes.ts` |
| `swarm-executor.ts` role cast | `task.role as AgentRole` — import missing (TS2345) | Added import from `swarm-orchestrator` | `packages/engine/src/llm/swarm-executor.ts` |
| `cli/engine.ts` config index | `getConfig()` return type too strict (TS2352) | Double cast `as unknown as Record<string, string \| undefined>` | `packages/cli/src/engine.ts` |
| `events.ts` `version` collision | `PackageInstalledEvent.version: string` ∩ `BaseEvent.version: 1` = `never`, making variants uninhabitable (TS2322) | Renamed `version` → `pkgVersion` in BOTH `engine` + `persistence` copies | `packages/engine/src/types/events.ts`, `packages/persistence/src/types/events.ts` |
| `openaicompat.test.ts` delta yields | 3 tests expected fewer results than generator actually yields (stale tests from before delta chunk support) | Updated expected lengths + last-element assertions | `tests/unit/openaicompat.test.ts` |

### Key Decisions
- **Eliminate nested drizzle-orm copies over path mapping**: Adding `drizzle-orm` to root `tsconfig.json` `paths` did not work with TypeScript project references (each child compiles independently). Removing `drizzle-orm` from workspace `package.json` files and keeping only root's copy ensures a single physical install, making all `SQL` types structurally identical.
- **Rename field over cast**: `PackageInstalledEvent.version: string` collides with `BaseEvent.version: 1` (literal). Renaming to `pkgVersion: string` in both `engine` and `persistence` copies of `events.ts` fixes the uninhabitable intersection type properly.
- **Import types explicitly**: Several errors (missing types, renamed types, wrong argument counts) were fixed by adding missing imports or adjusting type references.
- **Separate variable declaration over chained `??`**: The TS2871 error on long nullish chains was fixed by splitting into intermediate `const` variables.
- **Drizzle duplicate instance fix**: removing `drizzle-orm` from workspace `package.json` files + `npm install` removes the nested `node_modules` copy, leaving only root's `node_modules/drizzle-orm`

### Quality Metrics
- **Build**: `tsc -b` — **0 errors** ✓
- **Tests**: **197 files, 1725 tests — 0 failures** ✓
- **Test duration**: 42.9s

## Next Steps
1. **Fase 2**: Run `arely bench --real` with real LLM calls
2. **Fase 3**: Deploy web app (Next.js 15 + React 19) to production URL
3. **Fase 4**: Dynamic Role Selection (M7)
4. **Fase 5**: Swarm Learning (M8)
