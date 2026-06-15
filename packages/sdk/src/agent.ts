import type { LLMAdapter, SessionMessage as LlmSessionMessage } from "@arelyos/llm-core";
import { runAgentLoop, type Tool, type ToolContext, type ToolResult, type AgentLoopOptions, type AgentLoopResult } from "@arelyos/agent-core";
import type { ArelyTool } from "./config.js";
import { ulid } from "ulid";

export interface AgentOptions {
  system?: string;
  tools?: ArelyTool[];
  signal?: AbortSignal;
  maxIterations?: number;
  onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
}

export class AgentSession {
  private messages: ToolMessage[] = [];

  constructor(
    private llm: LLMAdapter,
    systemPrompt?: string,
  ) {
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt, timestamp: Date.now() });
    }
  }

  async run(prompt: string, opts?: AgentOptions): Promise<AgentLoopResult> {
    const msgs: ToolMessage[] = [
      ...this.messages,
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const tools = new Map<string, Tool>();
    for (const t of opts?.tools ?? []) {
      const tool: Tool = {
        name: t.name,
        description: t.description,
        async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
          const content = await t.execute(args);
          return { content };
        },
      };
      tools.set(t.name, tool);
    }

    const result = await runAgentLoop({
      llm: this.llm,
      messages: msgs as any,
      tools,
      emit: () => {},
      sessionId: ulid(),
      maxIterations: opts?.maxIterations ?? 20,
      signal: opts?.signal,
      onMessage: opts?.onMessage,
    });

    this.messages = msgs;
    return result;
  }
}

interface ToolMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}
