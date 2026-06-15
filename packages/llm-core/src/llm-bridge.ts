import type { LLMAdapter, LLMResponse } from "./adapter.js";
import type { SessionMessage } from "./types.js";
import { getApiProvider } from "./core/api-registry.js";
import type { Api, Message, Model, StreamOptions } from "./core/types.js";

export function createModel(config: {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}): Model {
  const apiMap: Record<string, string> = {
    openai: "openai-completions",
    anthropic: "anthropic-messages",
    ollama: "ollama",
    lmstudio: "openai-completions",
    local: "openai-completions",
  };
  return {
    id: config.model,
    name: config.model,
    api: (apiMap[config.provider] || "openai-completions") as any,
    provider: config.provider,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

export class ProviderBridgeAdapter implements LLMAdapter {
  constructor(private model: Model, private apiKey?: string) {}

  async *complete(messages: SessionMessage[], signal?: AbortSignal): AsyncGenerator<LLMResponse> {
    const api = getApiProvider(this.model.api);
    if (!api) throw new Error(`No provider registered for API: ${this.model.api}`);

    const systemMsg = messages.find((m) => m.role === "system");
    const ctxMsgs: Message[] = messages
      .filter((m) => m.role !== "system")
      .map((m): Message => {
        if (m.role === "user") {
          return { role: "user", content: m.content, timestamp: Date.now() };
        }
        return {
          role: "assistant",
          content: [{ type: "text" as const, text: m.content }],
          api: this.model.api as Api,
          provider: this.model.provider,
          model: this.model.id,
          usage: { input: 0, output: 0, totalTokens: 0 },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        };
      });

    const opts: StreamOptions = {
      signal,
      apiKey: this.apiKey,
    };

    const llmStream = api.stream(this.model, {
      systemPrompt: systemMsg?.content,
      messages: ctxMsgs,
    }, opts);
    let currentContent = "";
    const pendingToolCalls: Map<string, { name: string; args: string }> = new Map();

    for await (const event of llmStream) {
      if (event.type === "text_delta") {
        currentContent += event.delta;
      }
      if (event.type === "toolcall_end") {
        pendingToolCalls.set(event.toolCall.id, {
          name: event.toolCall.name,
          args: JSON.stringify(event.toolCall.arguments),
        });
      }
      if (event.type === "done") {
        if (event.reason === "toolUse" && pendingToolCalls.size > 0) {
          const toolCalls = Array.from(pendingToolCalls.entries()).map(([_, p]) => ({
            name: p.name,
            args: JSON.parse(p.args) as Record<string, unknown>,
          }));
          pendingToolCalls.clear();
          yield { content: currentContent || "", toolCalls };
          currentContent = "";
        } else if (currentContent) {
          yield { content: currentContent };
          currentContent = "";
        }
      }
    }
  }
}
