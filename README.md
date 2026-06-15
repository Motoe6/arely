# ARELY

**A modular Agent Operating System (AgentOS)** for long-lived goals, predictive planning, self-improvement, and cooperative agent swarms.

```bash
npm install -g @arely/cli
arely
```

> "Esto es un sistema operativo para agentes, no solo otro wrapper de LLM."

---

## Features

### Cognitive Core

| Layer | Capability |
|-------|-----------|
| **Observe** | Multi-provider LLM orchestration (Ollama, OpenAI-compatible, vLLM) |
| **Remember** | SQLite persistence via Drizzle ORM — sessions, messages, tool calls, permissions, events, goals, plans, milestones, memories, decisions, proposals, audits |
| **Reason** | Meta-reasoning, strategy selection, self-assessment, risk estimation, prediction calibration |
| **Plan** | Goal-aware forecasting, predictive execution gating, plan scoring, milestone tracking |
| **Select** | Adaptive model selection by task type, model performance registry, fallback chains |
| **Improve** | Self-improvement engine — outcome evaluation, goal generation, prioritization, evolution proposals |
| **Swarm** | Parallel swarm orchestration, shared swarm memory, role-based task graphs, dependency resolution |
| **Execute** | Tool system with lifecycle events, permission gate (deny/allow/ask), circuit breaker, retry with backoff, rate limiter, timeout |

### Interfaces

- **TUI** — Terminal UI via Ink v7 + React 19 (HeaderBar, Sidebar, Streaming, Tool Cards, Command Palette, Goals, Dashboard, Swarm Viz)
- **Web** — Next.js 15 / React 19 / CSS dark theme (Chat, Dashboard, Goals, Swarms, SSE, shared stores via `@arely/ui-core`)
- **CLI** — `arely serve`, `arely web`, `arely doctor`, `arely bench`, `arely models`, `arely version`

### Resilience

- Circuit breaker (Closed → Open → Half-Open) per tool
- Exponential backoff + jitter retry
- Sliding window rate limiter per (tool, session)
- Parallel executor with concurrency limit + AbortSignal
- Session recovery and resume

### Observability

- SSE event stream per session (20+ event types)
- Structured audit logs
- Health / Ready / Metrics endpoints
- Benchmark runner (vitest-based scenarios)

---

## Quick Start

```bash
# Install globally
npm install -g @arely/cli

# Start the engine server
arely serve

# Launch the Terminal UI (connects to running engine)
arely

# Open the Web UI
arely web
```

Or from source:

```bash
git clone https://github.com/your-org/arely
cd arely
npm install
npm run build

# Start engine
npm start

# Launch TUI
npm run cli

# Build web
npm run build:web
```

---

## Architecture

```
@arely/platform (monorepo)
├── packages/
│   ├── engine/         # Core engine — LLM, tools, persistence, server
│   ├── cli/            # TUI (Ink) + CLI dispatcher
│   ├── ui-core/        # Shared stores (app, session, ui) — Ink + React DOM
│   ├── benchamarks/    # Benchmark runner and collectors
│   ├── memory/         # Memory extraction and retrieval services
│   ├── persistence/    # Extended persistence stores
│   ├── agent-core/     # Agent abstractions and SDK
│   ├── sdk/            # Public API client
│   ├── plugins/        # Plugin system and registry
│   ├── evolution/      # Self-improvement engine
│   ├── llm-core/       # LLM adapter interfaces
│   └── flow-*/         # Legacy flow compiler/runtime (deprecated)
├── apps/
│   └── web/            # Next.js 15 Web UI
└── tests/              # Vitest (unit + integration)
```

---

## Engine API

```
POST /api/sessions              # Create and run a session
POST /api/sessions/:id/cancel   # Cancel a running session
GET  /api/sessions              # List sessions
GET  /api/sse                   # SSE event stream
POST /api/permissions/:id/approve
POST /api/permissions/:id/deny
GET  /api/goals                 # List/persist goals
GET  /api/goals/:id             # Goal detail + plans
GET  /api/goals/:id/forecast    # Goal forecast
POST /api/goals                 # Create goal
GET  /api/swarms                # List swarms
GET  /api/swarms/:id            # Swarm detail
GET  /api/swarms/:id/graph      # Task dependency graph
GET  /api/swarms/:id/memory     # Shared memory contributions
GET  /health                    # Health check
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8081 | Engine server port |
| `HOST` | 0.0.0.0 | Engine bind address |
| `OLLAMA_BASE_URL` | http://localhost:11434 | Ollama endpoint |
| `OPENAI_BASE_URL` | — | OpenAI-compatible endpoint |
| `ARELY_MAX_ITERATIONS` | 20 | Max agent loop turns |
| `ARELY_STREAMING` | true | Enable streaming |
| `TOOL_TIMEOUT_MS` | 120000 | Per-tool timeout |
| `PERMISSION_TIMEOUT_MS` | 120000 | Permission prompt timeout |
| `HTTP_BODY_LIMIT_BYTES` | 1048576 | Max request body |
| `NEXT_PUBLIC_ENGINE_URL` | http://localhost:8081 | Web UI engine URL |

---

## Cognitive Pipeline

```
User Input
  ↓
┌─────────────────────────────────────┐
│ Meta-Reasoner                       │
│  → Strategy Selection               │
│  → Model Selection                  │
│  → Risk Estimation                  │
│  → Prediction Calibration           │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Planning (optional)                 │
│  → Goal-Aware Forecast              │
│  → Plan Scorer                     │
│  → Execution Gate                  │
│  → Multi-step Plan                 │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Swarm (optional)                    │
│  → Task Graph Builder              │
│  → Role Assignment                 │
│  → Parallel Execution              │
│  → Shared Memory Aggregation       │
│  → Synthesis                       │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Agent Loop                          │
│  → Think → Tool → Observe → Repeat  │
│  → Permission Gate                  │
│  → Circuit Breaker                  │
│  → Retry + Rate Limit               │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Self-Improvement (post-session)     │
│  → Outcome Evaluation               │
│  → Improvement Prioritization       │
│  → Evolution Proposal               │
│  → Goal Generation                  │
└─────────────────────────────────────┘
  ↓
User Output
```

---

## License

MIT

---

## Acknowledgments

Built on top of Ollama, Drizzle ORM, Ink v7, Next.js 15, and the TypeScript ecosystem.
