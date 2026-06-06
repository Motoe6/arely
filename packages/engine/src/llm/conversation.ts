import { getConfig } from "../config/index.js";
/* eslint-disable @typescript-eslint/no-deprecated */
import type { SessionMessage } from "../types.js";
import type { Message } from "../types.js";
import { getSessionMessages } from "../persistence/message-store.js";

export function loadConversation(sessionId: string): SessionMessage[] {
  const messages = getSessionMessages(sessionId);
  return messages.map((m: Message) => ({
    role: m.role,
    content: m.content,
    timestamp: new Date(m.createdAt).getTime(),
  }));
}

export function injectToolResult(
  messages: SessionMessage[],
  toolName: string,
  result: string,
): SessionMessage[] {
  const config = getConfig();
  const truncated = truncateToolResult(result, config.MAX_TOOL_RESULT_CHARS);
  messages.push({
    role: "assistant",
    content: `[Result from ${toolName}]\n${truncated}`,
    timestamp: Date.now(),
  });
  return messages;
}

export function truncateToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const truncated = content.slice(0, maxChars);
  return `${truncated}\n[TRUNCATED: original length ${content.length} chars]`;
}

export function injectSystemPrompt(
  messages: SessionMessage[],
  prompt: string,
): SessionMessage[] {
  const hasSystem = messages.some((m) => m.role === "system");
  if (hasSystem) return messages;
  messages.unshift({
    role: "system",
    content: prompt,
    timestamp: Date.now(),
  });
  return messages;
}

export function hasReachedTokenLimit(
  _messages: SessionMessage[],
  _maxTokens: number,
): boolean {
  return false;
}
