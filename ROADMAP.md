# ARELY Roadmap

## v0.1.0 — AgentOS Foundation *(current)*

**Core**
- Multi-LLM orchestration (Ollama, OpenAI-compatible)
- Tool system with lifecycle events
- Permission gate (deny/allow/ask)
- Circuit breaker, retry, rate limiting
- Meta-reasoning and strategy selection
- Adaptive model selection
- Predictive planning with execution gating
- Goal persistence with forecasting
- Self-improvement engine (evolution proposals)
- Parallel swarms with shared memory
- Session resume and recovery

**Interfaces**
- Terminal UI (Ink v7 + React 19)
- Web UI (Next.js 15 + React 19)
- CLI: `arely serve | web | doctor | bench | models | version`

**Infrastructure**
- SQLite persistence (17 stores via Drizzle ORM)
- SSE event bus (20+ event types)
- Structured audit logging
- Health, ready, and metrics endpoints
- Benchmark runner

---

## v0.2.0 — Dynamic & Learning *(next)*

**Dynamic Role Selection**
- Task-classifier-driven role assignment
- Role performance tracking and adaptation
- Auto-scaling swarm composition

**Swarm Learning**
- Cross-session memory improvements
- Strategy effectiveness feedback loops
- Automated role specialization

**Planner/Manager Swarms**
- Hierarchical swarm orchestration
- Manager delegates to specialized sub-swarms
- Planner synthesizes multi-swarm outputs

**Real LLM Benchmarks**
- Benchmark scenarios with real model calls
- Single vs swarm mode comparison
- Shared memory vs no memory comparison
- Cost-per-task and utility gain tracking
- Published benchmark results

**CLI Enhancements**
- `arely init` — project scaffolding
- `arely login` — authentication
- `arely config` — configuration management
- `arely update` — self-update

---

## v0.3.0 — Ecosystem & Scale

**Plugin Marketplace**
- Plugin registry and discovery
- Lifecycle hooks (pre/post tool, pre/post session)
- Community plugin SDK

**Distributed Swarms**
- Multi-machine swarm coordination
- Shared memory synchronization across nodes
- Distributed task graphs

**Web Enhancements**
- Responsive design
- Dark/light theme switch
- Session history browser
- Conversation export (PDF, Markdown, JSON)

**Observability**
- Prometheus metrics export
- Structured distributed tracing
- Health registry with injected checks

---

## v1.0.0 — Production Release

- All v0.1.0–0.3.0 features stable
- Public documentation
- npm publish (`@arelyos/cli`, `@arelyos/engine`, `@arelyos/sdk`)
- GitHub Release with pre-built binaries
- CI/CD pipeline
- Contribution guidelines

---

## Legend

- ✅ Done
- 🔄 In progress
- ⏳ Planned
- 📝 Proposed
