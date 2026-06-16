import { ulid } from "ulid";
import type { LLMAdapter } from "@arelyos/llm-core";
import type {
  SessionMessage,
  Tool,
  AgentEvent,
  SessionThinkingEvent,
  AssistantMessageCreatedEvent,
  AssistantMessageCompletedEvent,
  AssistantMessageStreamDeltaEvent,
  ToolResultReceivedEvent,
  AgentLoopCompletedEvent,
  AgentLoopFailedEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "./types.js";

export interface AgentLoopOptions {
  llm: LLMAdapter;
  messages: SessionMessage[];
  tools: Map<string, Tool>;
  emit: (event: AgentEvent) => void;
  sessionId: string;
  maxIterations: number;
  signal?: AbortSignal;
  modelId?: string;
  onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  getMemoryContext?: (messages: SessionMessage[]) => Promise<SessionMessage[]>;
  onDecision?: (decision: {
    decisionType: string;
    decision: string;
    rationale: string;
    confidence?: number;
    proposalId?: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
  beforeToolCall?: (ctx: BeforeToolCallContext) => BeforeToolCallResult | Promise<BeforeToolCallResult>;
  afterToolCall?: (ctx: AfterToolCallContext) => AfterToolCallResult | Promise<AfterToolCallResult>;
  getSteeringMessages?: () => Promise<SessionMessage[]>;
  getFollowUpMessages?: () => Promise<SessionMessage[]>;
  shouldStopAfterTurn?: (turn: number) => boolean | Promise<boolean>;
}

export interface AgentLoopResult {
  content: string;
  turns: number;
}

function pushMsg(
  messages: SessionMessage[],
  role: "user" | "assistant" | "system",
  content: string,
  onMessage?: (role: "user" | "assistant" | "system", content: string) => void,
): void {
  messages.push({ role, content, timestamp: Date.now() });
  onMessage?.(role, content);
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { llm, messages, tools, emit, sessionId, maxIterations, signal, onMessage, onDecision } = opts;
  let fullFinalContent = "";

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      emit(buildFailedEvent(sessionId, "Aborted", i));
      return { content: fullFinalContent, turns: i };
    }

    const thinkingEvent: SessionThinkingEvent = {
      id: ulid(), version: 1, timestamp: Date.now(),
      type: "session_thinking", sessionId,
    };
    emit(thinkingEvent);

    try {
      const contextMessages = opts.getMemoryContext ? await opts.getMemoryContext(messages) : [];
      const llmMessages = [...contextMessages, ...messages];
      const generator = llm.complete(llmMessages, signal, opts.modelId);
      let chunkContent = "";
      let hasToolCalls = false;

      for await (const response of generator) {
        if (signal?.aborted) break;

        if (response.type === "delta") {
          emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_stream_delta", sessionId, delta: response.content });
          continue;
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          hasToolCalls = true;

          if (response.content) {
            const msgId = ulid();
            emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_created", sessionId, messageId: msgId, content: response.content });
            pushMsg(messages, "assistant", response.content, onMessage);
            emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_completed", sessionId, messageId: msgId, content: response.content });
          }

          for (const tc of response.toolCalls) {
            if (opts.beforeToolCall) {
              const beforeResult = await opts.beforeToolCall({
                toolName: tc.name, args: tc.args, sessionId, turn: i,
              });
              if (beforeResult.block) {
                pushMsg(messages, "assistant", `Tool ${tc.name} blocked: ${beforeResult.reason || "denied"}`, onMessage);
                continue;
              }
            }

            const tool = tools.get(tc.name);
            if (!tool) {
              pushMsg(messages, "assistant", `Unknown tool: ${tc.name}`, onMessage);
              continue;
            }

            try {
              const result = await tool.execute(tc.args, { sessionId, signal });
              let finalContent = result.content;
              let isError = false;

              if (opts.afterToolCall) {
                const afterResult = await opts.afterToolCall({
                  toolName: tc.name, args: tc.args, result: result.content, isError: false, sessionId, turn: i,
                });
                if (afterResult.content !== undefined) finalContent = afterResult.content;
                if (afterResult.isError !== undefined) isError = afterResult.isError;
              }

              emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "tool_result_received", sessionId, toolCallId: ulid(), toolName: tc.name, result: finalContent });
              pushMsg(messages, "assistant", finalContent, onMessage);

              await onDecision?.({
                decisionType: "tool_use",
                decision: `Used tool ${tc.name}`,
                rationale: `Agent invoked ${tc.name} to gather or process information`,
                confidence: 90,
                metadata: { toolName: tc.name, args: tc.args },
              });
            } catch (err) {
              const errMsg = `Error executing ${tc.name}: ${String(err)}`;
              if (opts.afterToolCall) {
                const afterResult = await opts.afterToolCall({
                  toolName: tc.name, args: tc.args, result: errMsg, isError: true, sessionId, turn: i,
                });
                pushMsg(messages, "assistant", afterResult.content ?? errMsg, onMessage);
              } else {
                pushMsg(messages, "assistant", errMsg, onMessage);
              }
            }
          }
        } else if (response.content) {
          chunkContent += response.content;
          pushMsg(messages, "assistant", response.content, onMessage);
        }
      }

      if (opts.shouldStopAfterTurn && await opts.shouldStopAfterTurn(i)) {
        if (chunkContent) {
          const msgId = ulid();
          emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_created", sessionId, messageId: msgId, content: chunkContent });
          emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_completed", sessionId, messageId: msgId, content: chunkContent });
        }
        const completedEvent: AgentLoopCompletedEvent = {
          id: ulid(), version: 1, timestamp: Date.now(),
          type: "agent_loop_completed", sessionId, turns: i + 1,
        };
        emit(completedEvent);
        return { content: fullFinalContent || chunkContent, turns: i + 1 };
      }

      if (chunkContent && !hasToolCalls) {
        fullFinalContent = chunkContent;
        const msgId = ulid();
        emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_created", sessionId, messageId: msgId, content: chunkContent });
        emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "assistant_message_completed", sessionId, messageId: msgId, content: chunkContent });
        emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "agent_loop_completed", sessionId, turns: i + 1 });
        return { content: fullFinalContent, turns: i + 1 };
      }

      if (!hasToolCalls) {
        emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "agent_loop_completed", sessionId, turns: i + 1 });
        return { content: fullFinalContent, turns: i + 1 };
      }
    } catch (err) {
      emit(buildFailedEvent(sessionId, String(err), i));
      return { content: fullFinalContent, turns: i + 1 };
    }
  }

  emit({ id: ulid(), version: 1, timestamp: Date.now(), type: "agent_loop_completed", sessionId, turns: maxIterations });
  return { content: fullFinalContent, turns: maxIterations };
}

function buildFailedEvent(sessionId: string, error: string, turns: number): AgentLoopFailedEvent {
  return { id: ulid(), version: 1, timestamp: Date.now(), type: "agent_loop_failed", sessionId, error, turns };
}
