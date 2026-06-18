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

## v1.2.0-b1.2 — Hierarchical Swarms, Autonomous Runtime, Real Benchmarks

### Hierarchical Swarms (T16.3)
- `hierarchical-planner.ts` — regex-based category inference (no LLM in planner), produces tree of `RootManager → ResearchManager/EngineeringManager/ValidationManager/SynthesisManager → leaf roles`
- `hierarchical-executor.ts` — recursive executor: internal nodes run children in parallel via `Promise.all` and synthesize; leaves execute assignments via LLM
- `hierarchical-types.ts` — `HierarchicalPlan`, `HierarchicalSwarmState`, `ManagerDefinition`, `ManagerRole` with typed categories
- `manager-planner.ts` — standalone ManagerSwarm planner for distributed heterogeneous execution (OpenAI, Anthropic, Ollama, OpenRouter routing)
- `manager-swarm.ts` — ManagerSwarm executor with cross-model provider routing per role

### Autonomous Runtime (T16.4)
- `runtime-types.ts` — `RuntimeGoal` (pending/running/blocked/failed/completed), `RuntimeState` (idle/starting/running/pausing/paused/stopping/stopped/failed)
- `runtime-loop.ts` — `AutonomousRuntime` with lifecycle hooks (onStart, onTick, onStop), `start()`, `stop()`, `pause()`, `resume()`, goals iteration loop
- `runtime-service.ts` — `RuntimeService` singleton, 9 CLI commands: `runtime start|stop|pause|resume|status|goals|goal create|retry|cancel`, `--json` flags
- `goal-manager.ts` — `DefaultGoalManager` with CRUD, retry, priorities, deadlines, parent-child goal trees
- `replanner.ts` — `DefaultReplanner` with threshold-based replanning (success<30% or predError>0.3), fallback to single-agent after retries exhausted
- `recovery-manager.ts` — `DefaultRecoveryManager` with circuit breaker state checks, recovery policy, max retries (default 3)
- `policy-engine.ts` — `DefaultPolicyEngine` with 7 configurable policies (maxRetries, recoveryDelayMs, replanningThreshold, maxReplanCount, adaptiveTimeout, goalTTLDuration, maxConcurrentGoals)
- 37 new unit tests across all runtime modules

### Cross-Session Memory (T15.6)
- `cross-session-memory.ts` — `CrossSessionMemory` store with `search()`, `save()`, entity extraction, relation building
- `entity-extractor.ts` — regex/pattern-based entity extraction from conversation text
- `entity-graph.ts` — `EntityGraph` with `addEntity()`, `addRelation()`, `findPath()`, `getSubgraph()`, `search()`
- `relation-builder.ts` — infers `USES`, `DEPENDS_ON`, `IMPLEMENTS`, `EXTENDS`, `CONTAINS` relations from text patterns
- `cross-session-memory-types.ts` — `MemoryEntry`, `Entity`, `Relation`, `EntityRelation` typed interfaces
- Global memory store in persistence layer with Drizzle ORM schema

### Distributed Enhancements (B2.1–B2.2)
- OTel distributed tracing propagation — `distributed_context` header for multi-node trace correlation
- Pluggable worker discovery framework — abstract `DiscoveryProvider` with `register()`, `discover()`, `heartbeat()`, `unregister()`

### Benchmarks (T16.B1)
- **7 benchmark modes**: single, planner, swarm, shared-memory-swarm, hierarchical, distributed, soak
- **16 scenarios** across 6 categories: coding, research, planning, tool-use, multi-step-research, implementation-design
- `scenario-runner.ts` — `runHierarchicalDeterministic()`, `runHierarchicalLive()`, `runDistributedDeterministic()`, `runDistributedLive()`, `runSoakBenchmarks()` with parseDuration()
- Extended leaderboards with `hierarchicalEfficiency`, `distributedEfficiency`, `learningGain` metrics
- Report generator with per-mode summary tables
- New CLI flags: `--manager-hierarchical`, `--distributed`, `--swarm-heterogeneous`, `--duration`

### Benchmark Results (18 Jun 2026 — Ollama local)
```
┌──────────────────────┬──────────┬──────────┬──────────┬──────────┐
│ Modo                 │ Utility  │ Latencia │ Goal Gain│ Costo    │
├──────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Hierarchical (hetero)│ 0.71     │  6ms     │ 0.57     │ $0.0252  │
│ Hierarchical (pure)  │ 0.67     │ 13ms     │ 0.63     │ $0.0252  │
│ Swarm                │ 0.66     │ 21ms     │ 0.50     │ $0.0084  │
│ Distributed          │ 0.64     │ 10ms     │ 0.53     │ $0.0210  │
│ Shared-Memory        │ 0.62     │  9ms     │ 0.46     │ $0.0084  │
└──────────────────────┴──────────┴──────────┴──────────┴──────────┘
```
- **Ollama real**: 100% success, 11ms avg latency, $0.0084 total, **score 0.823**
- **165/165 thresholds passed, 0 failures** across all modes
- Hierarchical recommended as default mode for complex tasks

### Production Fixes
- `packages/cli/src/bin.ts`: `spawn("npm", ..., { shell: true })` → `spawn(process.execPath, [tsxPath, ...])` — eliminates cmd.exe dependency, enables WSL/Docker/Linux
- `packages/benchmarks/src/scenario-runner.ts`: `loadConfig()` before `checkAllProviders()` — fixes "Config not loaded" error
- `packages/benchmarks/src/cli.ts`: `BENCHMARK_ENGINE_URL` assigned before all execution paths — fixes soak and other modes
- `scenario-runner.ts` + `cli.ts` + `bin.ts`: all interactive `console.log` → `opts?.jsonOutput ? console.error : console.log` — clean stdout in `--json` mode

### Quality
- Test suite: **1869 passing tests** across 209 files — 0 failures
- TypeScript build: **0 errors**
- Benchmark thresholds: 165/165 passed (33 hierarchical, 33 distributed, 99 swarm-hetero)
- Architecture: 4 benchmark reports generated with real Ollama provider

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
