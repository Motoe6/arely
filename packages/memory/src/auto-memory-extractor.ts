import type { LLMAdapter } from "@arelyos/llm-core";
import type { MemoryType, MemorySource } from "./memory-types.js";
import type { SessionMessage } from "@arelyos/llm-core";

export interface ExtractedMemory {
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source: MemorySource;
  tags: string[];
}

export interface AutoMemoryExtractorOptions {
  llm: LLMAdapter;
  signal?: AbortSignal;
}

const MEMORY_EXTRACTION_PROMPT = `Analyze the following conversation and extract any important information that should be remembered as a "memory". This includes user preferences, project facts, architectural decisions, workflow patterns, or other notable information.

For each memory, return a JSON array with objects containing:
- "type": one of "user_preference", "project_fact", "architecture_decision", "workflow_pattern", "conversation_summary"
- "key": a short snake_case identifier for this memory
- "value": a concise description of what to remember
- "confidence": a number 0-100 indicating how certain you are this is correct
- "tags": relevant tags as a string array

Only extract information that is explicit or clearly implied. Return an empty array if nothing worth remembering is found.

Return ONLY valid JSON, no other text.`;

const EPOCH_SUMMARY_PROMPT = `Summarize the following conversation exchange in 2-3 concise sentences. Focus on:
1. The main topic or question discussed
2. Key decisions, conclusions, or discoveries
3. Any important context for future reference

Conversation:`;

async function callLLM(
  llm: LLMAdapter,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const chatMessages: SessionMessage[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      timestamp: Date.now(),
    })),
  ];

  let fullContent = "";
  const generator = llm.complete(chatMessages, signal);
  for await (const response of generator) {
    fullContent += response.content;
  }
  return fullContent.trim();
}

export async function extractMemories(
  conversationMessages: Array<{ role: string; content: string }>,
  opts: AutoMemoryExtractorOptions,
): Promise<ExtractedMemory[]> {
  const conversationText = conversationMessages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const raw = await callLLM(opts.llm, MEMORY_EXTRACTION_PROMPT, [
    { role: "user", content: conversationText },
  ], opts.signal);

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m: Record<string, unknown>) =>
        m.type && m.key && m.value && typeof m.type === "string" && typeof m.key === "string" && typeof m.value === "string",
      )
      .map((m: Record<string, unknown>) => ({
        type: m.type as MemoryType,
        key: m.key as string,
        value: m.value as string,
        confidence: typeof m.confidence === "number" ? Math.max(0, Math.min(100, m.confidence)) : 100,
        source: "inferred" as MemorySource,
        tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
      }));
  } catch {
    return [];
  }
}

export async function extractEpochSummary(
  epochMessages: Array<{ role: string; content: string }>,
  opts: AutoMemoryExtractorOptions,
): Promise<string> {
  const conversationText = epochMessages
    .map((m) => `${m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System"}: ${m.content}`)
    .join("\n");

  const raw = await callLLM(opts.llm, EPOCH_SUMMARY_PROMPT, [
    { role: "user", content: conversationText },
  ], opts.signal);

  return raw || "(LLM summary unavailable)";
}
