# Runtime Architecture

## Startup Sequence

```
CLI (cli.ts)
  │
  ├── firstRunWizard() / settingsFlow()   ← @clack/prompts
  │     └── ~/.arely/config.json
  │
  ├── cmdDoctor()                          ← diagnostics (API key, Ollama, etc.)
  │
  ├── cmdModelsList() / cmdModelUse()
  │
  ├── cmdChat() / cmdAgent()              ← REPL session
  │     └── Session.create()
  │           └── AgentLoop
  │
  └── cmdServer()                         ← node main()
        └── loadConfig()                  ← Zod envSchema
        └── registerBuiltInApiProviders() ← OpenAI / Anthropic / Ollama
        └── connect() + pushSchema()      ← SQLite (better-sqlite3)
        └── new SessionManager()
        └── registerToolHandlers()
        └── httpServer.listen(port)
```

### Entry Points

| Mode | File | Trigger |
|------|------|---------|
| CLI menu | `packages/engine/src/cli.ts` | `node cli` (no args) |
| Chat REPL | `packages/engine/src/cli.ts` → `cmdChat()` | `node cli chat` |
| Agent REPL | `packages/engine/src/cli.ts` → `cmdAgent()` | `node cli agent` |
| Server | `packages/engine/src/index.ts` → `main()` | `node cli server` |

### Config Loading

```
process.env
    │
    ├── Zod envSchema (config/schema.ts)
    │     ├── llmSchema       (ARELY_API_KEY, MODEL, PROVIDER, etc.)
    │     ├── toolsSchema     (EXA_KEY, WEBSEARCH_PROVIDER, timeouts)
    │     ├── serverSchema    (PORT, DB_PATH, LOG_LEVEL)
    │     ├── planningSchema  (PLANNING_ENABLED, PLAN_MAX_STEPS)
    │     ├── agentSchema     (AGENT_RUNTIME_ENABLED)
    │     ├── notificationSchema (Slack/Discord/Email webhooks)
    │     └── pathsSchema     (POLICY_PACKS_DIR, USER_TEMPLATES_DIR)
    │
    └── migrateDeprecatedEnv()  ← OPENCODE_* → ARELY_* mapping
```

User config file `~/.arely/config.json` complements env vars with `defaultProvider`, `defaultModel`, `enabledModels`, `mode`.

---

## Session Lifecycle

```
Session.create(sessionId)
    │
    ├── initEpoch(sessionId)
    ├── register with SessionManager
    │
    ├── [chat mode]
    │     └── runAgentLoop(llm, messages, tools, opts)
    │           │
    │           ├── getMemoryContext()     ← injects [Self-Knowledge] + [Strategy] + [Relevant Memories]
    │           ├── getSteeringMessages()  ← hook (plugin extensible)
    │           ├── for each turn (≤ maxIterations):
    │           │     ├── build LLM messages
    │           │     ├── llm.complete()   ← async generator
    │           │     ├── process tool calls
    │           │     │     ├── beforeToolCall(ctx)  ← hook (can block)
    │           │     │     ├── tool.execute(args)
    │           │     │     └── afterToolCall(ctx)   ← hook (can modify result)
    │           │     ├── onDecision(decision)       ← logs to decision_log
    │           │     └── shouldStopAfterTurn(turn)  ← hook
    │           │
    │           └── post-loop (fire-and-forget):
    │                 ├── extractConversationMemory()  → memory_store
    │                 ├── learnFromSessionOutcomes()   → memory_store (tags: auto-learned)
    │                 ├── reflectOnSession()           → memory_store (tag: meta-reflection)
    │                 └── evaluateStrategies()         → memory_store (tag: strategy-performance)
    │
    └── Session.close()
```

### Message Flow (single turn)

```
User message
    │
    ├── SessionMessage[] accumulated
    │
    ├── getMemoryContext()
    │     ├── MetaReasoner.buildMetaContextString()
    │     │     └── [Self-Knowledge]
    │     │           ├── Decision history (per-type stats)
    │     │           ├── Learned patterns (auto-learned memories)
    │     │           ├── Areas needing attention
    │     │           └── Strategy performance history
    │     │
    │     ├── StrategyEvaluator.buildStrategyContext()
    │     │     └── [Strategy Performance]
    │     │           └── Per-strategy success rates + convergence
    │     │
    │     ├── StrategySelector.recommend()
    │     │     └── [Strategy Recommendation]
    │     │           └── argmax(expected_rate) from observed data
    │     │
    │     └── MemoryRetrievalService.getRelevant()
    │           └── [Relevant Memories] (scored by token overlap + confidence + recency)
    │
    ├── ProviderBridgeAdapter.complete(messages, signal)
    │     │
    │     ├── getApiProvider(model.api)  ← registry lookup
    │     ├── map SessionMessage[] → Message[]
    │     ├── api.stream(model, context, options)  ← AsyncIterable<AssistantMessageEvent>
    │     └── yield LLMResponse { content, toolCalls }
    │
    └── Tool calls processed via agent-loop hooks
```

---

## LLM Abstraction Layer

### Adapter Interface (`llm/adapter.ts`)

```typescript
interface LLMAdapter {
  complete(messages: SessionMessage[], signal?: AbortSignal): AsyncGenerator<LLMResponse>;
}

interface LLMResponse {
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  modelId?: string;
}
```

### Provider System (`llm/core/`)

```
StreamFunction<TApi, TOptions>
    │
    ├── registerApiProvider({ api, stream })
    │     └── Map<Api, ApiProvider>
    │
    ├── getApiProvider(api)  → ApiProvider | undefined
    │
    └── ProviderBridgeAdapter (implements LLMAdapter)
          └── wraps StreamFunction via async generator
```

### Provider Implementations (`llm/providers/`)

| Provider | API Type | Stream Function | Base URL |
|----------|----------|----------------|----------|
| OpenAI | `openai-completions` | `streamOpenAICompletions` | `https://api.openai.com/v1` |
| Anthropic | `anthropic-messages` | `streamAnthropic` | `https://api.anthropic.com/v1` |
| Ollama | `ollama` | `streamOllama` | `http://localhost:11434` |
| LM Studio | `openai-completions` | (uses OpenAI adapter) | `http://localhost:1234` |

All registered via `registerBuiltInApiProviders()` at startup.

### Event Stream Protocol

```
AssistantMessageEvent
    │
    ├── start          → partial AssistantMessage
    ├── text_delta     → streaming text
    ├── text_end       → final text for index
    ├── thinking_delta → thinking tokens
    ├── toolcall_start → tool call begins
    ├── toolcall_delta → partial tool args (JSON)
    ├── toolcall_end   → complete tool call
    ├── done           → stop / length / toolUse
    └── error          → aborted / error
```

---

## Tool System

### Registration (agent-loop entry)

```
registerToolHandler(name, Tool)
    │
    └── Map<string, Tool> passed to runAgentLoop()
```

### Core Tools

| Tool | Source | Description |
|------|--------|-------------|
| `websearch` | src/tools/websearch.ts | Exa / Parallel search provider |
| `webfetch` | src/tools/webfetch.ts | URL → Markdown converter |
| `reddit_hot` | src/tools/reddit.ts | Reddit hot posts |
| `reddit_search` | src/tools/reddit.ts | Reddit search |
| `rss_fetch` | src/tools/rss.ts | RSS feed reader |
| `memory_get` | src/tools/memory.ts | Read agent memory |
| `memory_set` | src/tools/memory.ts | Write agent memory |

### Tool Planning (`tools/descriptor.ts` + `planner.ts`)

```typescript
ToolDescriptor {
  name, title, description, inputSchema,
  owner: { kind: "core" | "plugin" },
  executor?: ToolExecutorRef,
  availability?: ToolAvailabilityExpression,  ← visibility rules
  sortKey?: string
}
```

`buildToolPlan()` evaluates availability expressions at runtime to produce:

```typescript
ToolPlan {
  visible: ToolPlanEntry[],
  hidden: HiddenToolPlanEntry[]
}
```

### Guard Layer

```
beforeToolCall(ctx)  → can block tool
    │
    ├── circuit-breaker.ts  ← state machine (closed/open/half-open)
    ├── retry.ts            ← withRetry()
    ├── rate-limiter.ts     ← sliding window
    └── errors.ts           ← TimeoutError, CancelledError
```

---

## Hooks (Agent Loop Extension Points)

| Hook | Interface | Purpose |
|------|-----------|---------|
| `getMemoryContext` | `(messages) => Promise<SessionMessage[]>` | Inject memory/self-knowledge into LLM |
| `onDecision` | `(decision) => void \| Promise<void>` | Log decision when tool is called |
| `beforeToolCall` | `(ctx) => BeforeToolCallResult` | Block tools based on context |
| `afterToolCall` | `(ctx) => AfterToolCallResult` | Modify tool results |
| `shouldStopAfterTurn` | `(turn) => boolean` | Early termination |
| `getSteeringMessages` | `() => Promise<SessionMessage[]>` | System-level steering |
| `getFollowUpMessages` | `() => Promise<SessionMessage[]>` | Post-turn follow-up |

---

## Persistence

### Database

- **Engine**: SQLite via better-sqlite3 + Drizzle ORM
- **Location**: Configurable via `DB_PATH` env (default: `~/.arely/data.db`)
- **Mode**: WAL mode + foreign_keys ON
- **Migrations**: Raw SQL in `persistence/migrate.ts` (26 tables + 12 migrations + 48 indexes)

### Key Tables

| Table | Records |
|-------|---------|
| `sessions` | Active/historical sessions |
| `messages` | Per-session message history |
| `decision_log` | Every decision with outcome |
| `memory_store` | Semantic + episodic memories (TTL, access tracking) |
| `model_performance` | Per-(model, provider, taskType) stats |
| `context_epochs` | Context window epochs |
| `workflows` / `workflow_versions` | Template/workflow storage |
| `evolution_proposals` / `evolution_audit` | Self-evolution history |
| `pipeline_runs` / `pipeline_step_runs` | Pipeline execution traces |
| `notification_queue` | Async notification delivery |
| `agent_pipelines` | Multi-step agent pipelines |

---

## Directory Layout (engine)

```
src/
├── index.ts              ← main() server entry
├── cli.ts                ← CLI entry (commands + TUI)
├── config/               ← Zod schemas + env parsing
├── server/               ← HTTP server, sessions, agent loop
│   └── modes/            ← agent-mode.ts, planning-mode.ts
├── llm/                  ← LLM adapters, cognitive engine
│   ├── core/             ← Provider registry, event stream, types
│   └── providers/        ← OpenAI, Anthropic, Ollama implementations
├── tools/                ← Tool descriptors, planner, implementations
├── plugins/              ← Plugin manifest + loader
├── persistence/          ← Schema, migrations, data stores
├── transport/            ← HTTP server, router, middleware, request context
├── structural/           ← Structural evolution service
├── evolution/            ← Evolution proposals, template evolution
├── templates/            ← Template registry, parameter recommender
├── agents/               ← Scheduler, pipeline executor, drift analyzer
├── models/               ← Model registry + metrics
├── types/                ← Event types, policy change types
├── ui/                   ← Dashboard React components
└── compiler/             ← Build service + package management
```
