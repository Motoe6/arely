# Contributing to ARELY

## Prerequisites

- Node.js 22+
- npm 10+
- Ollama (or any OpenAI-compatible endpoint)

## Setup

```bash
git clone https://github.com/your-org/arely
cd arely
npm install
npm run build
```

## Development

```bash
# Start engine (with hot-reload)
npm run dev

# In another terminal — launch TUI
npm run cli

# Web UI
npm run dev:web
```

## Project Structure

```
packages/
  engine/        # Core engine (LLM, tools, persistence, server)
  cli/           # TUI + CLI dispatcher (Ink v7)
  ui-core/       # Shared stores (app, session, ui)
  benchmarks/    # Benchmark runner
  memory/        # Memory extraction/retrieval
  persistence/   # Extended stores
  sdk/           # Public API client
  plugins/       # Plugin system
  evolution/     # Self-improvement
  agent-core/    # Agent abstractions
  llm-core/      # LLM adapter interfaces
apps/
  web/           # Next.js 15 Web UI
tests/
  unit/          # Unit tests (vitest)
  integration/   # Integration tests (vitest)
  benchmark/     # Benchmark scenarios
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm test` | Run all tests |
| `npm run test:coverage` | Test with coverage |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint (engine) |
| `npm run bench` | Run benchmarks |
| `npm run cli` | Launch TUI |
| `npm run dev:web` | Web dev server |
| `npm run build:web` | Build web |
| `npm run db:push` | Push DB schema |
| `npm run db:studio` | Drizzle Studio |

## Guidelines

1. **Events are additive** — never modify existing event shapes
2. **Persist before SSE emit** — events must be durable before broadcast
3. **No `workspace:*` protocol** — use `"*"` for npm workspace deps
4. **Test coverage ≥80%** on all new engine modules
5. **TypeScript strict mode** enforced via `tsc -b`
6. **All new features need unit + integration tests**

## License

MIT
