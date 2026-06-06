import { ulid } from "ulid";
import type { LLMAdapter } from "../llm/adapter.js";
/* eslint-disable @typescript-eslint/no-deprecated */
import type { SessionMessage } from "../types.js";
import type { Tool } from "../tools/registry.js";
import type {
  AgentEvent,
  SessionThinkingEvent,
  AssistantMessageCreatedEvent,
  AssistantMessageCompletedEvent,
  ToolResultReceivedEvent,
  AgentLoopCompletedEvent,
  AgentLoopFailedEvent,
} from "../types/events.js";

export interface AgentLoopOptions {
  llm: LLMAdapter;
  messages: SessionMessage[];
  tools: Map<string, Tool>;
  emit: (event: AgentEvent) => void;
  sessionId: string;
  maxIterations: number;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  content: string;
  turns: number;
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { llm, messages, tools, emit, sessionId, maxIterations, signal } = opts;
  let fullFinalContent = "";

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      emit(buildFailedEvent(sessionId, "Aborted", i));
      return { content: fullFinalContent, turns: i };
    }

    const thinkingEvent: SessionThinkingEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_thinking",
      sessionId,
    };
    emit(thinkingEvent);

    try {
      const generator = llm.complete(messages, signal);
      let chunkContent = "";
      let hasToolCalls = false;

      for await (const response of generator) {
        if (signal?.aborted) break;

        if (response.toolCalls && response.toolCalls.length > 0) {
          hasToolCalls = true;

          if (response.content) {
            const msgId = ulid();
            const createdEvent: AssistantMessageCreatedEvent = {
              id: ulid(),
              version: 1,
              timestamp: Date.now(),
              type: "assistant_message_created",
              sessionId,
              messageId: msgId,
              content: response.content,
            };
            emit(createdEvent);

            messages.push({
              role: "assistant",
              content: response.content,
              timestamp: Date.now(),
            });

            const completedEvent: AssistantMessageCompletedEvent = {
              id: ulid(),
              version: 1,
              timestamp: Date.now(),
              type: "assistant_message_completed",
              sessionId,
              messageId: msgId,
              content: response.content,
            };
            emit(completedEvent);
          }

          for (const tc of response.toolCalls) {
            const tool = tools.get(tc.name);
            if (!tool) {
              const errMsg = `Unknown tool: ${tc.name}`;
              messages.push({
                role: "assistant",
                content: `Tool error: ${errMsg}`,
                timestamp: Date.now(),
              });
              continue;
            }

            try {
              const result = await tool.execute(tc.args, { sessionId, signal });

              const resultEvent: ToolResultReceivedEvent = {
                id: ulid(),
                version: 1,
                timestamp: Date.now(),
                type: "tool_result_received",
                sessionId,
                toolCallId: ulid(),
                toolName: tc.name,
                result: result.content,
              };
              emit(resultEvent);

              messages.push({
                role: "assistant",
                content: result.content,
                timestamp: Date.now(),
              });
            } catch (err) {
              messages.push({
                role: "assistant",
                content: `Error executing ${tc.name}: ${String(err)}`,
                timestamp: Date.now(),
              });
            }
          }
        } else if (response.content) {
          chunkContent += response.content;
          messages.push({
            role: "assistant",
            content: response.content,
            timestamp: Date.now(),
          });
        }
      }

      if (chunkContent && !hasToolCalls) {
        fullFinalContent = chunkContent;
        const completedEvent: AgentLoopCompletedEvent = {
          id: ulid(),
          version: 1,
          timestamp: Date.now(),
          type: "agent_loop_completed",
          sessionId,
          turns: i + 1,
        };
        emit(completedEvent);
        return { content: fullFinalContent, turns: i + 1 };
      }

      if (!hasToolCalls) {
        const completedEvent: AgentLoopCompletedEvent = {
          id: ulid(),
          version: 1,
          timestamp: Date.now(),
          type: "agent_loop_completed",
          sessionId,
          turns: i + 1,
        };
        emit(completedEvent);
        return { content: fullFinalContent, turns: i + 1 };
      }
    } catch (err) {
      emit(buildFailedEvent(sessionId, String(err), i));
      return { content: fullFinalContent, turns: i + 1 };
    }
  }

  const completedEvent: AgentLoopCompletedEvent = {
    id: ulid(),
    version: 1,
    timestamp: Date.now(),
    type: "agent_loop_completed",
    sessionId,
    turns: maxIterations,
  };
  emit(completedEvent);
  return { content: fullFinalContent, turns: maxIterations };
}

function buildFailedEvent(sessionId: string, error: string, turns: number): AgentLoopFailedEvent {
  return {
    id: ulid(),
    version: 1,
    timestamp: Date.now(),
    type: "agent_loop_failed",
    sessionId,
    error,
    turns,
  };
}
