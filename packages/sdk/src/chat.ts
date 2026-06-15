import type { LLMAdapter, SessionMessage } from "@arely/llm-core";

export interface ChatOptions {
  system?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export class ChatSession {
  private messages: SessionMessage[] = [];

  constructor(
    private llm: LLMAdapter,
    systemPrompt?: string,
  ) {
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt, timestamp: Date.now() });
    }
  }

  async send(message: string, options?: ChatOptions): Promise<string> {
    const msgs: SessionMessage[] = [
      ...this.messages,
      { role: "user", content: message, timestamp: Date.now() },
    ];

    let fullContent = "";
    for await (const chunk of this.llm.complete(msgs, options?.signal)) {
      if (chunk.content) {
        fullContent += chunk.content;
        options?.onDelta?.(chunk.content);
      }
    }

    this.messages.push({ role: "user", content: message, timestamp: Date.now() });
    this.messages.push({ role: "assistant", content: fullContent, timestamp: Date.now() });

    return fullContent;
  }

  getMessages(): readonly SessionMessage[] {
    return this.messages;
  }

  reset(): void {
    this.messages = [];
  }
}
