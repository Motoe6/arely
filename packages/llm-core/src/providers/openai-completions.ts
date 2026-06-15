import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TextContent,
  ToolCall,
} from "../core/types.js";
import { AssistantMessageEventStreamImpl } from "../core/event-stream.js";

function hasToolHistory(messages: Message[]): boolean {
  for (const m of messages) {
    if (m.role === "toolResult") return true;
    if (m.role === "assistant" && m.content.some((c) => c.type === "toolCall")) return true;
  }
  return false;
}

function toOpenAIMessages(messages: Message[]) {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const content = typeof m.content === "string" ? m.content : m.content.map((c) => {
        if (c.type === "text") return { type: "text", text: c.text };
        if (c.type === "image") return { type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.data}` } };
        return { type: "text", text: "" };
      });
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const msg: any = { role: "assistant", content: "" };
      const toolCalls: any[] = [];
      for (const c of m.content) {
        if (c.type === "text") msg.content = c.text;
        if (c.type === "thinking") msg.content = c.thinking;
        if (c.type === "toolCall") {
          toolCalls.push({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          });
        }
      }
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
    } else if (m.role === "toolResult") {
      const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: text });
    }
  }
  return out;
}

function buildTools(context: Context): any[] | undefined {
  if (!context.tools || context.tools.length === 0) return undefined;
  return context.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    },
  }));
}

export const streamOpenAICompletions: StreamFunction<"openai-completions", StreamOptions> = (
  model,
  context,
  options,
) => {
  const stream = new AssistantMessageEventStreamImpl();

  (async () => {
    try {
      const body: any = {
        model: model.id,
        messages: toOpenAIMessages(context.messages),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (options?.temperature !== undefined) body.temperature = options.temperature;
      if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
      if (options?.stop) body.stop = options.stop;
      if (context.systemPrompt) {
        body.messages.unshift({ role: "system", content: context.systemPrompt });
      }
      if (context.tools && context.tools.length > 0 && hasToolHistory(context.messages)) {
        body.tools = buildTools(context);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      };
      if (options?.apiKey) {
        headers["Authorization"] = `Bearer ${options.apiKey}`;
      }

      const res = await fetch(model.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, totalTokens: 0 },
            stopReason: "error",
            errorMessage: `API error ${res.status}: ${text}`,
            timestamp: Date.now(),
          },
        });
        stream.end();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buf = "";
      let partial: AssistantMessage | null = null;
      const pendingToolCalls = new Map<string, { id: string; name: string; args: string }>();
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
          if (!t || !t.startsWith("data: ")) continue;
          const data = t.slice(6);
          if (data === "[DONE]") break;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            const finish = chunk.choices?.[0]?.finish_reason;

            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens || 0;
              outputTokens = chunk.usage.completion_tokens || 0;
            }

            if (!delta) continue;

            if (delta.content) {
              if (!partial) {
                const msg: AssistantMessage = {
                  role: "assistant",
                  content: [],
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  usage: { input: 0, output: 0, totalTokens: 0 },
                  stopReason: "stop",
                  timestamp: Date.now(),
                };
                partial = msg;
                stream.push({ type: "start", partial: msg });
              }
              const ci = partial.content.findIndex((c) => c.type === "text");
              if (ci >= 0) {
                (partial.content[ci] as TextContent).text += delta.content;
              } else {
                partial.content.push({ type: "text", text: delta.content });
              }
              stream.push({ type: "text_delta", contentIndex: ci >= 0 ? ci : partial.content.length - 1, delta: delta.content, partial: { ...partial } });
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const key = String(tc.index);
                let pending = pendingToolCalls.get(key);
                if (tc.id) {
                  pending = { id: tc.id, name: "", args: "" };
                  pendingToolCalls.set(key, pending);
                }
                if (pending) {
                  if (tc.function?.name) pending.name += tc.function.name;
                  if (tc.function?.arguments) pending.args += tc.function.arguments;
                }
              }
            }

            if (finish === "tool_calls" && pendingToolCalls.size > 0) {
              const toolCalls: ToolCall[] = [];
              for (const [_, p] of pendingToolCalls) {
                toolCalls.push({
                  type: "toolCall",
                  id: p.id,
                  name: p.name,
                  arguments: JSON.parse(p.args),
                });
              }
              pendingToolCalls.clear();

              if (!partial) {
                partial = {
                  role: "assistant",
                  content: [],
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  usage: { input: 0, output: 0, totalTokens: 0 },
                  stopReason: "toolUse",
                  timestamp: Date.now(),
                };
                stream.push({ type: "start", partial });
              }

              for (const tc of toolCalls) {
                partial.content.push(tc);
                stream.push({ type: "toolcall_end", contentIndex: partial.content.length - 1, toolCall: tc, partial: { ...partial } });
              }

              const finalMsg: AssistantMessage = {
                ...partial,
                usage: { input: inputTokens, output: outputTokens, totalTokens: inputTokens + outputTokens },
                stopReason: "toolUse",
              };
              stream.push({ type: "done", reason: "toolUse", message: finalMsg });
              stream.end(finalMsg);
              return;
            }

            if (finish === "stop") {
              const finalMsg: AssistantMessage = {
                ...(partial || {
                  role: "assistant" as const,
                  content: [],
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  usage: { input: 0, output: 0, totalTokens: 0 },
                  stopReason: "stop" as const,
                  timestamp: Date.now(),
                }),
                usage: { input: inputTokens, output: outputTokens, totalTokens: inputTokens + outputTokens },
              };
              stream.push({ type: "done", reason: "stop", message: finalMsg });
              stream.end(finalMsg);
              return;
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      const finalMsg: AssistantMessage = {
        ...(partial || {
          role: "assistant" as const,
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, totalTokens: 0 },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        }),
        usage: { input: inputTokens, output: outputTokens, totalTokens: inputTokens + outputTokens },
      };
      stream.push({ type: "done", reason: "stop", message: finalMsg });
      stream.end(finalMsg);
    } catch (err) {
      stream.push({
        type: "error",
        reason: "error",
        error: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, totalTokens: 0 },
          stopReason: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        },
      });
      stream.end();
    }
  })();

  return stream;
};

export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions> = (
  model,
  context,
  options,
) => streamOpenAICompletions(model, context, options);
