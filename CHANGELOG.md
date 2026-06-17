# Changelog

## v1.0.0 — Production Release *(current)*

### CLI
- `arely init` — interactive setup wizard (provider, model, swarm, port, API key)
- `arely config` — view current configuration
- `arely login` — authentication setup (API key, GitHub stub, local-only)
- `arely update` — npm registry version check

### Benchmarks
- 11 real-world benchmark scenarios across 5 categories (coding, research, planning, tool-use, swarm)
- 4 execution modes per scenario: Single, Planner, Swarm, SharedMemorySwarm
- Deterministic mode (simulated realistic data) and `--real` mode (actual LLM calls via engine HTTP API)
- Metrics: success rate, latency, cost, goal progress gain, utility, prediction error, tool calls, tokens
- Comparison metrics: swarm vs single success gain, latency delta, cost ratio
- Aggregated averages per execution mode
- JSON + Markdown report to `benchmark-reports/`
- Secenario files with YAML frontmatter (id, tags, difficulty, success criteria, expected metrics)

### Documentation
- README.md — full project overview, features, quick start, architecture, API
- ROADMAP.md — v0.1.0 → v1.0.0 product roadmap
- CHANGELOG.md — complete change history
- LICENSE — MIT
- CONTRIBUTING.md — setup, structure, guidelines

### Platform
- All packages versioned 1.0.0
- React 19 unified across monorepo
- Next.js 15 + styled-jsx 5.1.6 for React 19 compatibility
- Web build: 0 ESLint errors, static export

---

## v1.2.0-b1 — Distributed Multi-Node Swarms

### Distributed Swarms
- WebSocket coordinator/worker transport with send buffer
- Multi-node heterogeneous swarm execution (OpenAI, Ollama, OpenRouter)
- Dynamic provider:model routing across worker nodes
- Worker registration buffering — fixes silent message loss on connect
- Lease management and automated failover recovery
- Distributed Prometheus metrics (30+ metric constants)
- End-to-end validated cluster execution (201 test files, 1752 tests)

### Quality
- TypeScript build: 0 errors
- Test suite: 1752 passing tests across 201 files
- Real multi-node deployment validated end-to-end
- Failover metrics: disconnects, reassignments, state transitions captured
- Reconnection: offline→online state transitions verified

---

## v0.1.0 — AgentOS Foundation

### Cognitive Core (T7–T15)

- **Meta-Reasoning** — strategy evaluation and selection per task type
- **Adaptive Model Selection** — model performance registry with fallback chains
- **Predictive Planning** — goal-aware forecasting, execution gating, plan scoring
- **Goal Persistence** — full CRUD for goals, plans, milestones with progress tracking
- **Goal-Aware Forecasting** — predicted success probability, progress gain, expected utility
- **Self-Improvement Engine** — outcome evaluation, improvement goal generation, prioritization, evolution proposals
- **Parallel Swarms** — task-graph-based orchestration, role assignment, parallel execution, synthesis
- **Shared Swarm Memory** — cross-role contribution aggregation and retrieval

### Agent Loop

- Session lifecycle (create, run, cancel, resume)
- Tool system with SSE lifecycle events (pending → running → completed | failed | timed_out | cancelled)
- Permission gate with deny/allow/ask modes + approval cache + timeout auto-deny
- Conversation builder with system prompt injection and tool result injection
- Streaming assistant messages via SSE

### Resilience (M3)

- Circuit breaker (Closed → Open → Half-Open) per-tool isolation
- Exponential backoff + jitter retry with non-retryable error classification
- Sliding window rate limiter per (toolName, sessionId)
- Parallel executor with concurrency limit + AbortSignal

### Persistence (17 stores)

- Sessions, messages, tool calls, permissions, approval cache, audit log, events
- Goals, plans, milestones, memories, decisions, proposals, evolution audits
- Config store, context epochs, feedback, metrics, template versions
- SQLite via Drizzle ORM with migration runner

### Interfaces

- **TUI** (Ink v7 + React 19):
  - HeaderBar, Sidebar (always visible, Ctrl+S toggle)
  - Streaming with animated spinner + blinking cursor
  - Collapsible tool cards (auto-expand on error)
  - Command palette with fuzzy search (Ctrl+P)
  - Goals panel with forecast visualization
  - Dashboard with engine metrics
  - Swarm visualization (timeline, graph, memory)
  - StatusBar with G:M:S metrics
- **Web** (Next.js 15 + React 19):
  - Chat with auto-scroll, streaming cursor, cancel button
  - Sidebar with agent modes, sessions, goals, swarms, keyboard shortcuts
  - Dashboard overlay (health, sessions, models registry)
  - Goals panel with plans and milestones
  - Swarm panel with timeline, graph, and memory tabs
  - Command palette
  - Permission overlay (approve/deny)
  - CSS dark theme with animations
- **CLI**:
  - `arely serve` — start engine server
  - `arely web` — start web dev server
  - `arely doctor` — system diagnostics
  - `arely bench` — run benchmarks
  - `arely models` — list available models
  - `arely version` — print version
- **Shared stores** (`@arelyos/ui-core`): app-store, session-store, ui-store — single source of truth for Ink and React DOM

### Infrastructure

- Middleware pipeline (requestId → requestContext → cors → auth → bodyParser → requestCounter → requestLogger → errorHandler)
- AsyncLocalStorage per-request context
- Graceful drain with second-signal force exit
- Monorepo with npm workspaces (packages/* + apps/*)
- TypeScript 6 + tsc -b project references
- Vitest (unit + integration), 95%+ coverage on core modules

### Engine API

- `POST /api/sessions` — create and run session
- `POST /api/sessions/:id/cancel` — cancel session
- `GET /api/sessions` — list sessions
- `GET /api/sse` — SSE event stream
- `POST /api/permissions/:id/approve\|deny` — permission responses
- `GET/POST /api/goals` — goal CRUD
- `GET /api/goals/:id/forecast` — goal forecast
- `GET /api/swarms` — list swarms
- `GET /api/swarms/:id [/graph, /memory]` — swarm details
- `GET /health` — health check
- SSE events: session_started, session_state_change, session_thinking, session_completed, assistant_message_*, tool_call_*, permission_*, agent_loop_*, retry_attempt, circuit_*

### Migration from Legacy

- Extracted `src/` → `packages/engine/` monorepo
- Renamed project from codename (feat/rename-arely)
- Deprecated flow-compiler/runtime packages in favor of engine-native agent loop
- Removed all legacy pipeline abstractions
- Flow-editor and its templates preserved but marked deprecated

---

## Pre-v0.1.0

### Platform

- Phase 2.2: YAML/JSON parser + deterministic compiler (Workflow → F30)
- Phase 2.1: flow-runtime workspace — types, resolver, DAG validator
- Week 1: extract src/ → packages/engine/ monorepo
- Baseline: pre-monorepo state
