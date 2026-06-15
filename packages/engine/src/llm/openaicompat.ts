import type { LLMAdapter, LLMResponse } from '@arelyos/llm-core';
import type { SessionMessage } from '../types.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface Delta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface Chunk {
  choices: Array<{
    delta: Delta;
    finish_reason: string | null;
  }>;
}

export class OpenAICompatAdapter implements LLMAdapter {
  private pendingToolCalls = new Map<string, { name: string; args: string }>();

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private textToolMode: boolean = false,
    private authHeader = "Authorization",
    private authPrefix = "Bearer",
  ) {}

  private buildAuthHeaders(): Record<string, string> {
    return {
      [this.authHeader]: this.authPrefix
        ? `${this.authPrefix} ${this.apiKey}`
        : this.apiKey,
    };
  }

  async *complete(messages: SessionMessage[], signal?: AbortSignal): AsyncGenerator<LLMResponse> {
    const chatMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ChatMessage[];

    this.pendingToolCalls.clear();
    let currentContent = '';
    let sawNativeToolCall = false;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildAuthHeaders(),
      },
      body: JSON.stringify({
        model: this.model,
        messages: chatMessages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;

        try {
          const chunk: Chunk = JSON.parse(data);
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            currentContent += delta.content;
            yield { content: delta.content, type: "delta" as const };
          }

          if (delta.tool_calls) {
            sawNativeToolCall = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let pending = this.pendingToolCalls.get(String(idx));
              if (tc.id) {
                pending = { name: '', args: '' };
                this.pendingToolCalls.set(String(idx), pending);
              }
              if (pending) {
                if (tc.function?.name) pending.name += tc.function.name;
                if (tc.function?.arguments) pending.args += tc.function.arguments;
              }
            }
          }

          const finish = chunk.choices[0]?.finish_reason;
          if (finish === 'tool_calls') {
            const toolCalls = Array.from(this.pendingToolCalls.entries()).map(
              ([_id, tc]) => ({
                name: tc.name,
                args: JSON.parse(tc.args) as Record<string, unknown>,
              }),
            );
            this.pendingToolCalls.clear();
            if (currentContent) {
              yield { content: currentContent, toolCalls };
            } else {
              yield { content: '', toolCalls };
            }
            currentContent = '';
          } else if (finish === 'stop') {
            if (currentContent) {
              yield { content: currentContent };
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    if (!sawNativeToolCall && currentContent && this.textToolMode) {
      const textToolCalls = parseTextToolCalls(currentContent);
      if (textToolCalls.length > 0) {
        const cleanContent = stripTextToolCalls(currentContent);
        yield { content: cleanContent, toolCalls: textToolCalls };
      }
    }
  }
}

function parseTextToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  const results: Array<{ name: string; args: Record<string, unknown> }> = [];

  const jsonBlockRe = /```(?:json)?\s*\n?(\{[\s\S]*?"tool"[\s\S]*?\})\s*\n?```/g;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && parsed.args) {
        results.push({ name: parsed.tool, args: parsed.args as Record<string, unknown> });
      }
    } catch {
      // skip unparseable blocks
    }
  }

  if (results.length === 0) {
    const singleLineRe = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*\{([\s\S]*?)\}\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = singleLineRe.exec(text)) !== null) {
      try {
        const argsStr = `{${m[2]}}`;
        const args = JSON.parse(argsStr) as Record<string, unknown>;
        results.push({ name: m[1], args });
      } catch {
        // skip
      }
    }
  }

  return results;
}

function stripTextToolCalls(text: string): string {
  return text.replace(/```(?:json)?\s*\n?\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?```/g, '').trim();
}
