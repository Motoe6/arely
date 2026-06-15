import type {
  AssistantMessage,
  Context,
  StreamFunction,
  StreamOptions,
} from "../core/types.js";
import { AssistantMessageEventStreamImpl } from "../core/event-stream.js";

function toOllamaMessages(context: Context) {
  const out: any[] = [];
  if (context.systemPrompt) {
    out.push({ role: "system", content: context.systemPrompt });
  }
  for (const m of context.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("") });
    } else if (m.role === "assistant") {
      const text = m.content.filter((c) => c.type === "text").map((c) => (c as any).text).join("");
      out.push({ role: "assistant", content: text });
    } else if (m.role === "toolResult") {
      const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      out.push({ role: "tool", content: text });
    }
  }
  return out;
}

export const streamOllama: StreamFunction<"ollama", StreamOptions> = (model, context, options) => {
  const stream = new AssistantMessageEventStreamImpl();

  (async () => {
    try {
      const body: any = {
        model: model.id,
        messages: toOllamaMessages(context),
        stream: true,
      };
      if (options?.temperature !== undefined) body.temperature = options.temperature;
      if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

      if (context.tools && context.tools.length > 0) {
        body.tools = context.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters as any },
        }));
      }

      const res = await fetch(model.baseUrl.replace(/\/+$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "error", errorMessage: `Ollama error ${res.status}: ${text}`, timestamp: Date.now() } });
        stream.end();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buf = "";
      let partial: AssistantMessage | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            const chunk = JSON.parse(t);
            if (chunk.message?.content) {
              if (!partial) {
                partial = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() };
                stream.push({ type: "start", partial });
              }
              partial.content.push({ type: "text", text: chunk.message.content });
              stream.push({ type: "text_delta", contentIndex: partial.content.length - 1, delta: chunk.message.content, partial: { ...partial } });
            }
            if (chunk.done) {
              const finalMsg: AssistantMessage = {
                ...(partial || { role: "assistant" as const, content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "stop" as const, timestamp: Date.now() }),
                usage: { input: 0, output: 0, totalTokens: 0 },
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
    } catch (err) {
      stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "error", errorMessage: err instanceof Error ? err.message : String(err), timestamp: Date.now() } });
      stream.end();
    }
  })();

  return stream;
};
