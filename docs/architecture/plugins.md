# Plugin & Tool Architecture

## Overview

ARELY's extensibility is built on three layers that work together:

```
Plugin System     →  manages lifecycle of extensions
Tool Descriptor   →  declares what a tool is and when it's available
Tool Planner      →  evaluates availability at runtime
```

The design isolates extension code from the core runtime. A plugin registers tools, providers, hooks, or channels via a declarative manifest. The tool planner evaluates visibility rules before handing tools to the agent loop.

---

## Plugin System

### Plugin Manifest

**File:** `plugins/manifest.ts`

```typescript
interface PluginManifest {
  id: string;             // unique identifier, e.g. "github-tools"
  name: string;           // human-readable, e.g. "GitHub Tools"
  version: string;        // semver
  description?: string;
  entry: string;          // path to plugin entry module
  capabilities?: PluginCapability[];
}
```

### Capability Types

```typescript
type PluginCapability =
  | { kind: "provider";   api: string }       // LLM provider (e.g. "openai-completions")
  | { kind: "tool";       name: string }       // Tool implementation
  | { kind: "channel";    name: string }       // Notification channel (e.g. "slack")
  | { kind: "hook";       name: string }       // Agent loop hook
  | { kind: "mcp-server"; name: string }       // MCP server integration
```

### Plugin Lifecycle

**File:** `plugins/loader.ts`

```
loadPlugin(manifestPath)
    │
    ├── Import manifest JSON
    │
    ├── Import entry module
    │     └── Returns LoadedPlugin { manifest, exports }
    │
    └── Register in internal Map<string, LoadedPlugin>
          │
          ├── findPluginsByCapability(kind, name?)
          │     └── e.g. findPluginsByCapability("tool", "websearch")
          │
          ├── getPlugin(id)
          ├── listPlugins()
          └── unloadPlugin(id)
```

### What a Plugin Can Export

The entry module can export:

| Export | Registers Via | Effect |
|--------|--------------|--------|
| `registerProvider(api)` | `api-registry.ts` | Adds LLM streaming function |
| `registerTool(descriptor, executor)` | `tools/registry.ts` | Adds tool to available set |
| `registerHook(name, fn)` | `agent-loop.ts` | Attaches hook handler |
| `registerChannel(name, send)` | `notifiers/` | Adds notification channel |

---

## Tool Descriptor System

### Descriptor Structure

**File:** `tools/descriptor.ts`

```typescript
interface ToolDescriptor {
  name: string;           // tool identifier, e.g. "websearch"
  title?: string;         // display name
  description: string;    // LLM-facing description of what it does
  inputSchema: JsonObject; // JSON Schema for arguments
  owner: ToolOwnerRef;    // { kind: "core" } | { kind: "plugin"; pluginId: string }
  executor?: ToolExecutorRef; // who runs it
  availability?: ToolAvailabilityExpression; // visibility rules
  sortKey?: string;       // ordering in tool plan
}
```

### Availability Expressions

```typescript
type ToolAvailabilitySignal =
  | { kind: "always" }                          // always visible
  | { kind: "auth";   providerId: string }      // requires auth provider
  | { kind: "config"; path: string[];           // requires config value
       check?: "exists" | "non-empty" }
  | { kind: "env";    name: string }            // requires env variable
  | { kind: "plugin-enabled"; pluginId: string } // requires loaded plugin

type ToolAvailabilityExpression =
  | ToolAvailabilitySignal
  | { allOf: ToolAvailabilityExpression[] }      // all must pass
  | { anyOf: ToolAvailabilityExpression[] }      // at least one must pass
```

### Examples

```typescript
// A tool requiring an API key
{
  name: "websearch",
  availability: { kind: "env"; name: "TAVILY_API_KEY" }
}

// A plugin tool with config requirement
{
  name: "github_list_prs",
  owner: { kind: "plugin"; pluginId: "github" },
  availability: {
    allOf: [
      { kind: "plugin-enabled"; pluginId: "github" },
      { kind: "config"; path: ["github", "token"]; check: "non-empty" }
    ]
  }
}

// A tool with fallback providers
{
  name: "websearch",
  availability: {
    anyOf: [
      { kind: "env"; name: "TAVILY_API_KEY" },
      { kind: "env"; name: "EXA_API_KEY" }
    ]
  }
}
```

### Availability Context

```typescript
interface ToolAvailabilityContext {
  config?: Record<string, unknown>;  // current app config
  env?: Record<string, string>;      // current env vars
  enabledPluginIds?: string[];       // loaded plugin IDs
}
```

### Plan Result

```
buildToolPlan(descriptors[], ctx) → ToolPlan
    │
    ├── visible: ToolPlanEntry[]         ← tools available right now
    │     └── sorted by sortKey → name
    │
    └── hidden: HiddenToolPlanEntry[]    ← tools with diagnostics
          └── each includes reason: "env-missing" | "config-missing" |
                                     "plugin-disabled" | "auth-missing"
```

### Diagnostic Reasons

| Reason | Meaning |
|--------|---------|
| `env-missing` | Required env variable not set |
| `config-missing` | Config path missing or empty |
| `plugin-disabled` | Required plugin not loaded |
| `auth-missing` | Auth provider not configured |
| `unknown-signal` | Unrecognized signal kind |

---

## Tool Registry

**File:** `tools/registry.ts`

```
Registry
    │
    ├── registerTool(name, Tool)
    │     └── Adds to internal map
    │
    ├── getTool(name) → Tool | undefined
    │
    ├── getToolList() → Tool[]
    │
    ├── createToolPipeline(toolNames) → Pipeline
    │     └── Sequential execution with result passing
    │
    └── executeToolPipeline(pipeline, input) → Promise<any>
```

### Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>,
           context: ToolContext): AsyncGenerator<ToolResult>;
}
```

---

## Guard Layer

Each tool execution passes through a guard pipeline before reaching the handler:

```
Tool call requested
    │
    ├── Rate Limiter        ← sliding window (tools/rate-limiter.ts)
    │     └── Rejects if over limit
    │
    ├── Circuit Breaker     ← state machine (tools/circuit-breaker.ts)
    │     └── Rejects if circuit is open
    │
    ├── Timeout             ← configurable per tool (tools/errors.ts)
    │     └── Cancels if exceeds TOOL_TIMEOUT_MS
    │
    └── Retry               ← configurable (tools/retry.ts)
          └── Retries on failure up to RETRY_MAX_ATTEMPTS
```

### Circuit Breaker States

```
closed ──(failures > threshold)──► open
  ▲                                   │
  │                                   │
  └──(timeout)── half-open ──(success)──┘
```

---

## Integration With Agent Loop

```
runAgentLoop(opts)
    │
    ├── Tool descriptors registered at startup
    │
    ├── buildToolPlan(descriptors, ctx) → visible list
    │
    ├── Tools passed to LLM as `tools` parameter
    │
    ├── On tool call:
    │     ├── beforeToolCall({ toolName, args }) → can block
    │     ├── circuit-breaker → rate-limiter → retry
    │     ├── tool.execute(args) → result
    │     └── afterToolCall({ result }) → can modify
    │
    └── Result fed back to LLM for next turn
```

---

## Adding a New Plugin

```typescript
// my-plugin/index.ts
import { registerApiProvider } from "@arely/llm/core";
import type { PluginManifest } from "@arely/plugins";

export const manifest: PluginManifest = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  entry: __filename,
  capabilities: [
    { kind: "tool", name: "my_custom_action" },
  ],
};

export function registerTools(register: any) {
  register({
    name: "my_custom_action",
    description: "Does something useful",
    inputSchema: { type: "object", properties: { /* ... */ } },
    owner: { kind: "plugin", pluginId: "my-plugin" },
    availability: {
      allOf: [
        { kind: "plugin-enabled", pluginId: "my-plugin" },
        { kind: "config", path: ["my_plugin", "api_key"], check: "non-empty" },
      ],
    },
  }, executor);
}
```

```bash
arely plugin install ./my-plugin
```

---

## Directory Layout

```
plugins/
├── manifest.ts          ← PluginManifest + PluginCapability types
└── loader.ts            ← loadPlugin, findPluginsByCapability, etc.

tools/
├── descriptor.ts        ← ToolDescriptor, ToolAvailabilityExpression types
├── planner.ts           ← buildToolPlan()
├── registry.ts          ← Tool registration and pipeline
├── circuit-breaker.ts   ← State machine guard
├── rate-limiter.ts      ← Sliding window guard
├── retry.ts             ← Retry with backoff
├── errors.ts            ← TimeoutError, CancelledError
├── parallel-executor.ts ← Queue-based concurrent execution
└── (tool implementations)
    ├── websearch.ts
    ├── webfetch.ts
    ├── reddit.ts
    ├── rss.ts
    └── memory.ts
```
