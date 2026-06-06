import { ulid } from "ulid";
/* eslint-disable @typescript-eslint/no-deprecated */
import type { SessionState, SessionMessage, ToolCallPart } from "../types.js";
import type { SSEBus } from "./sse.js";
import type { LLMAdapter } from "../llm/adapter.js";
import { createToolRegistry, type Tool } from "../tools/registry.js";
import { PermissionGate } from "../permissions/gate.js";
import { createSearchProvider } from "../tools/provider-factory.js";
import { loadConfig, getConfig } from "../config/index.js";
import { createSession } from "../persistence/session-store.js";
import {
  PHI3_SYSTEM_PROMPT,
  GEMMA4_SYSTEM_PROMPT,
  GENERIC_TEXT_TOOL_PROMPT,
} from "../llm/prompts.js";
import type {
  AgentEvent,
  SessionStartedEvent,
  SessionStateChangedEvent,
  SessionCompletedEvent,
} from "../types/events.js";
import type { ExecutionMode } from "./execution-mode.js";
import { AgentModeExecution } from "./modes/agent-mode.js";
import { PlanningModeExecution } from "./modes/planning-mode.js";

export type ToolCallMode = "native" | "text";

function detectToolCallMode(model: string): ToolCallMode {
  const lower = model.toLowerCase();
  const textOnlyModels = [
    "phi3", "phi-3", "phi-3-mini", "phi-3-small", "phi-3-medium",
    "gemma", "gemma4", "gemma-4", "gemma-2",
    "deepseek-coder", "deepseek-chat", "deepseek-v2",
    "codellama", "codegemma",
    "mistral-7b", "mixtral-8x7b",
    "yi-34b", "yi-6b",
    "qwen-7b", "qwen2-7b",
    "llama3", "llama-3-8b",
  ];
  return textOnlyModels.some((m) => lower.includes(m)) ? "text" : "native";
}

const MODEL_SYSTEM_PROMPTS: Record<string, string | undefined> = {
  phi3: PHI3_SYSTEM_PROMPT,
  "phi-3": PHI3_SYSTEM_PROMPT,
  "phi-3-mini": PHI3_SYSTEM_PROMPT,
  gemma: GEMMA4_SYSTEM_PROMPT,
  gemma4: GEMMA4_SYSTEM_PROMPT,
  "gemma-4": GEMMA4_SYSTEM_PROMPT,
};

function getSystemPrompt(model: string): string | undefined {
  const lower = model.toLowerCase();
  for (const [key, prompt] of Object.entries(MODEL_SYSTEM_PROMPTS)) {
    if (lower.includes(key)) return prompt;
  }
  return GENERIC_TEXT_TOOL_PROMPT;
}

export class AgentSession {
  id = ulid();
  state: SessionState = "idle";
  messages: SessionMessage[] = [];
  toolCalls: ToolCallPart[] = [];
  toolCallMode: ToolCallMode;
  readonly sse: SSEBus;
  readonly llm: LLMAdapter;
  readonly tools: Map<string, Tool>;
  private gate: PermissionGate;
  private abortController = new AbortController();
  private systemPromptInjected = false;
  private executionMode: ExecutionMode;

  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  constructor(
    sse: SSEBus,
    llm: LLMAdapter,
    private config: {
      permissions: { websearch: string; webfetch: string };
      searchProvider?: "exa" | "parallel";
      model?: string;
      toolMode?: ToolCallMode;
      mode?: "agent" | "planning";
      agentId?: string;
    },
  ) {
    loadConfig();
    this.sse = sse;
    this.llm = llm;
    this.gate = new PermissionGate(sse, this.id);
    const searchProvider = createSearchProvider({
      OPENCODE_WEBSEARCH_PROVIDER: config.searchProvider ?? "exa",
    } as Parameters<typeof createSearchProvider>[0]);
    this.tools = createToolRegistry({
      sse,
      sessionId: this.id,
      gate: this.gate,
      searchProvider,
      agentId: config.agentId,
    });
    this.toolCallMode = config.toolMode ?? detectToolCallMode(config.model ?? "");
    this.executionMode = config.mode === "planning"
      ? new PlanningModeExecution()
      : new AgentModeExecution();
  }

  private emit(event: AgentEvent): void {
    this.sse.emit(this.id, event);
  }

  private setState(s: SessionState): void {
    this.state = s;
    const event: SessionStateChangedEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_state_change",
      sessionId: this.id,
      state: s,
    };
    this.emit(event);
  }

  private sessionEnd(reason: string, error?: string): void {
    if (this.state === "completed" || this.state === "error") return;
    this.state = reason === "error" ? "error" : "completed";
    const event: SessionCompletedEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_completed",
      sessionId: this.id,
      reason,
      ...(error ? { error } : {}),
    };
    this.emit(event);
  }

  private ensureSystemPrompt(): void {
    if (this.systemPromptInjected) return;
    if (this.toolCallMode !== "text") return;

    const prompt = getSystemPrompt(this.config.model ?? "");
    if (prompt) {
      this.messages.unshift({
        role: "system",
        content: prompt,
        timestamp: Date.now(),
      });
    }
    this.systemPromptInjected = true;
  }

  async run(query: string): Promise<void> {
    createSession({ id: this.id, query, model: this.config.model ?? "unknown", toolMode: this.toolCallMode });
    this.setState("running");
    this.ensureSystemPrompt();

    const startedEvent: SessionStartedEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_started",
      sessionId: this.id,
      query,
      model: this.config.model ?? "unknown",
      toolMode: this.toolCallMode,
    };
    this.emit(startedEvent);

    const userMsg: SessionMessage = {
      role: "user",
      content: query,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);

    const cfg = getConfig();
    const result = await this.executionMode.run(this, query);

    this.sessionEnd("completed", result.turns >= cfg.OPENCODE_MAX_ITERATIONS ? "max_iterations" : undefined);
  }

  resolvePermission(id: string, granted: boolean): void {
    this.gate.resolve(id, granted);
  }

  abort(): void {
    this.abortController.abort();
    this.sessionEnd("error", "Aborted");
  }
}
