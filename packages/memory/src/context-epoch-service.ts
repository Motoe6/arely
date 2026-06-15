import { ulid } from "ulid"
import {
  createEpoch,
  getCurrentEpoch,
  getEpochsBySession,
  addEpochMessage,
  getEpochMessages,
  updateEpoch,
  getEpochMessageCount as getMessageCount,
} from "@arelyos/persistence"
import type { ContextEpoch, EpochMessage } from "./epoch-types.js"
import { memoryRetrievalService } from "./memory-retrieval-service.js"

const DEFAULT_EPOCH_THRESHOLD = 50

let epochThreshold = DEFAULT_EPOCH_THRESHOLD

export type EpochSummarizer = (epochId: string, messages: EpochMessage[]) => Promise<string>;
let epochSummarizer: EpochSummarizer | null = null;

export function setEpochThreshold(threshold: number): void {
  epochThreshold = threshold
}

export function setEpochSummarizer(fn: EpochSummarizer): void {
  epochSummarizer = fn;
}

export function initEpoch(sessionId: string): ContextEpoch {
  const existing = getCurrentEpoch(sessionId)
  if (existing) return existing
  return createEpoch({ sessionId, epochNumber: 1 })
}

export function addEpochMessageToSession(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
): { epoch: ContextEpoch; message: EpochMessage } {
  let epoch = getCurrentEpoch(sessionId)
  if (!epoch) {
    epoch = createEpoch({ sessionId, epochNumber: 1 })
  }

  const seq = getMessageCount(sessionId) + 1
  const msg = addEpochMessage({ sessionId, epochId: epoch.id, role, content, sequence: seq })

  // Update in-memory message count (already incremented in store)
  epoch = maybeRotateEpoch(sessionId) ?? epoch

  return { epoch, message: msg }
}

export function maybeRotateEpoch(sessionId: string): ContextEpoch | null {
  const epoch = getCurrentEpoch(sessionId)
  if (!epoch) return null
  if (epoch.messageCount < epochThreshold) return null

  const baseline = summarizeEpoch(epoch.id)
  updateEpoch(epoch.id, { baselineContext: baseline })

  // Fire-and-forget LLM summarization when a summarizer is configured
  if (epochSummarizer) {
    const msgs = getEpochMessages(epoch.id);
    epochSummarizer(epoch.id, msgs).then((llmSummary) => {
      updateEpoch(epoch.id, { baselineContext: llmSummary });
    }).catch(() => {
      // LLM summarization failed; previous baseline already set
    });
  }

  const epochs = getEpochsBySession(sessionId)
  const nextNumber = epochs.length + 1
  return createEpoch({ sessionId, epochNumber: nextNumber })
}

export function summarizeEpoch(epochId: string): string {
  const messages = getEpochMessages(epochId)
  const userCount = messages.filter((m) => m.role === "user").length
  const assistantCount = messages.filter((m) => m.role === "assistant").length
  const systemCount = messages.filter((m) => m.role === "system").length
  const total = messages.length
  return `Epoch: ${userCount} user, ${assistantCount} assistant, ${systemCount} system messages (${total} total)`
}

export function buildContext(
  sessionId: string,
  opts?: { recentMessageCount?: number },
): { compressed: string; currentMessages: EpochMessage[] } {
  const epochs = getEpochsBySession(sessionId)
  const currentEpoch = epochs[epochs.length - 1]
  const olderEpochs = epochs.slice(0, -1)

  const compressedParts: string[] = []
  for (const ep of olderEpochs) {
    compressedParts.push(`[Epoch ${ep.epochNumber}]: ${ep.baselineContext || "(no summary)"}`)
  }
  const compressed = compressedParts.join("\n")

  const currentMessages = currentEpoch
    ? getEpochMessages(currentEpoch.id)
    : []

  return { compressed, currentMessages }
}

export interface ContextStats {
  totalEpochs: number
  currentEpochNumber: number
  totalMessages: number
  threshold: number
  epochs: Array<{ number: number; messages: number; summarized: boolean }>
}

export interface InjectedMemoryMessage {
  role: "system";
  content: string;
  timestamp: number;
}

export async function injectMemoryIntoContext(
  sessionId: string | null,
  query: string,
  limit: number = 8,
): Promise<InjectedMemoryMessage[]> {
  const memories = await memoryRetrievalService.getRelevant({
    sessionId: sessionId ?? undefined,
    query,
    limit,
  });

  if (memories.length === 0) return [];

  const lines = memories.map(
    (m) =>
      `- [${m.type}] ${m.key}: ${m.value} (confidence: ${m.confidence}, relevance: ${(m.relevanceScore * 100).toFixed(0)}%)`,
  );

  return [
    {
      role: "system",
      content: `Relevant memories:\n${lines.join("\n")}`,
      timestamp: Date.now(),
    },
  ];
}

export function getContextStats(sessionId: string): ContextStats {
  const epochs = getEpochsBySession(sessionId)
  const current = epochs[epochs.length - 1]
  return {
    totalEpochs: epochs.length,
    currentEpochNumber: current?.epochNumber ?? 0,
    totalMessages: current ? getMessageCount(sessionId) : 0,
    threshold: epochThreshold,
    epochs: epochs.map((e) => ({
      number: e.epochNumber,
      messages: e.messageCount,
      summarized: !!e.baselineContext,
    })),
  }
}
