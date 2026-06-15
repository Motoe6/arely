import type { SessionMessage } from "./types.js";

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  modelId?: string;
  type?: "delta";
}

export interface LLMAdapter {
  complete(messages: SessionMessage[], signal?: AbortSignal): AsyncGenerator<LLMResponse>;
}
