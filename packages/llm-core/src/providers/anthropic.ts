import type {
  AssistantMessage,
  Context,
  Message,
  StreamFunction,
  StreamOptions,
  TextContent,
  ToolCall,
} from "../core/types.js";
import { AssistantMessageEventStreamImpl } from "../core/event-stream.js";

function toAnthropicMessages(context: Context) {
  const system: string[] = [];
  const msgs: any[] = [];

  for (const m of context.messages) {
    if (m.role === "user") {
      const content = typeof m.content === "string" ? m.content : m.content.map((c) => {
        if (c.type === "text") return { type: "text", text: c.text };
        if (c.type === "image") return { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } };
        return { type: "text", text: "" };
      });
      msgs.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const blocks: any[] = [];
      for (const c of m.content) {
        if (c.type === "text") blocks.push({ type: "text", text: c.text });
        if (c.type === "thinking") blocks.push({ type: "thinking", thinking: c.thinking });
        if (c.type === "toolCall") {
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: c.arguments,
          });
        }
      }
      msgs.push({ role: "assistant", content: blocks });
    } else if (m.role === "toolResult") {
      const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      msgs.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: text }],
      });
    }
  }

  if (context.systemPrompt) {
    system.push(context.systemPrompt);
  }

  return { system: system.length > 0 ? system.join("\n") : undefined, messages: msgs };
}

export const streamAnthropic: StreamFunction<"anthropic-messages", StreamOptions> = (model, context, options) => {
  const stream = new AssistantMessageEventStreamImpl();

  (async () => {
    try {
      const { system, messages } = toAnthropicMessages(context);
      const body: any = {
        model: model.id,
        max_tokens: options?.maxTokens || 4096,
        messages,
        stream: true,
      };
      if (system) body.system = system;
      if (options?.temperature !== undefined) body.temperature = options.temperature;

      if (context.tools && context.tools.length > 0) {
        body.tools = context.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as any,
        }));
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(options?.headers || {}),
      };
      if (options?.apiKey) {
        headers["x-api-key"] = options.apiKey;
      }

      const res = await fetch(model.baseUrl.replace(/\/+$/, "") + "/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "error", errorMessage: `Anthropic error ${res.status}: ${text}`, timestamp: Date.now() } });
        stream.end();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buf = "";
      let partial: AssistantMessage | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith("event:") && !t.startsWith("data:")) continue;

          if (t.startsWith("data: ")) {
            const data = t.slice(6);
            try {
              const chunk = JSON.parse(data);
              if (chunk.type === "content_block_delta" && chunk.delta?.text) {
                if (!partial) {
                  partial = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() };
                  stream.push({ type: "start", partial });
                }
                const textBlock = partial.content.find((c) => c.type === "text") as TextContent | undefined;
                if (textBlock) {
                  textBlock.text += chunk.delta.text;
                } else {
                  partial.content.push({ type: "text", text: chunk.delta.text });
                }
                stream.push({ type: "text_delta", contentIndex: partial.content.length - 1, delta: chunk.delta.text, partial: { ...partial } });
              }
              if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
                if (!partial) {
                  partial = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() };
                  stream.push({ type: "start", partial });
                }
              }
              if (chunk.type === "message_delta" && chunk.usage) {
                outputTokens = chunk.usage.output_tokens || 0;
              }
              if (chunk.type === "message_start" && chunk.message?.usage) {
                inputTokens = chunk.message.usage.input_tokens || 0;
              }
              if (chunk.type === "message_stop") {
                const finalMsg: AssistantMessage = {
                  ...(partial || { role: "assistant" as const, content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "stop" as const, timestamp: Date.now() }),
                  usage: { input: inputTokens, output: outputTokens, totalTokens: inputTokens + outputTokens },
                };
                stream.push({ type: "done", reason: "stop", message: finalMsg });
                stream.end(finalMsg);
                return;
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (err) {
      stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "error", errorMessage: err instanceof Error ? err.message : String(err), timestamp: Date.now() } });
      stream.end();
    }
  })();

  return stream;
};
