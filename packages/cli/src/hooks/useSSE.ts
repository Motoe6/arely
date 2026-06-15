import type { SSEBus } from "@arely/engine/server/sse.js";
import { sessionStore } from "@arely/ui-core/stores/session-store.js";
import type { SessionState } from "@arely/ui-core/stores/session-store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvent = { type: string; [key: string]: any };

type ToolPart = {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
};

export function wireSSE(sse: SSEBus, sessionId: string): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (event: AnyEvent) => {
    switch (event.type) {
      case "session_state_change": {
        sessionStore.setState({ sessionState: event.state as SessionState });
        break;
      }
      case "session_completed":
        sessionStore.setState({ sessionState: "completed" });
        break;
      case "session_thinking":
        sessionStore.setState({ isThinking: true });
        break;
      case "assistant_message_stream_delta": {
        const prev = sessionStore.getState().streamingText;
        sessionStore.setState({ streamingText: prev + event.delta, isThinking: false });
        break;
      }
      case "assistant_message_completed": {
        const prev = sessionStore.getState().streamingText;
        const fullContent = event.content as string;
        sessionStore.setState({
          streamingText: "",
          messages: [...sessionStore.getState().messages, { role: "assistant" as const, content: prev || fullContent }],
        });
        break;
      }
      case "tool_call_pending":
      case "tool_call_started": {
        const part: ToolPart = {
          id: event.toolCallId as string,
          toolName: event.toolName as string,
          status: event.type === "tool_call_pending" ? "pending" : "running",
          args: event.args as Record<string, unknown>,
          startTime: Date.now(),
        };
        const current = sessionStore.getState().toolCalls as ToolPart[];
        const idx = current.findIndex((t) => t.id === part.id);
        if (idx >= 0) {
          const next = [...current];
          next[idx] = { ...next[idx], ...part };
          sessionStore.setState({ toolCalls: next });
        } else {
          sessionStore.setState({ toolCalls: [...current, part] });
        }
        break;
      }
      case "tool_call_completed": {
        const current = sessionStore.getState().toolCalls as ToolPart[];
        const idx = current.findIndex((t) => t.id === event.toolCallId);
        if (idx >= 0) {
          const next = [...current];
          next[idx] = {
            ...next[idx],
            status: "completed",
            result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            endTime: Date.now(),
          };
          sessionStore.setState({ toolCalls: next });
        }
        break;
      }
      case "tool_call_failed": {
        const current = sessionStore.getState().toolCalls as ToolPart[];
        const idx = current.findIndex((t) => t.id === event.toolCallId);
        if (idx >= 0) {
          const next = [...current];
          next[idx] = {
            ...next[idx],
            status: "error",
            error: event.error as string,
            endTime: Date.now(),
          };
          sessionStore.setState({ toolCalls: next });
        }
        break;
      }
      case "tool_call_timed_out": {
        const current = sessionStore.getState().toolCalls as ToolPart[];
        const idx = current.findIndex((t) => t.id === event.toolCallId);
        if (idx >= 0) {
          const next = [...current];
          next[idx] = {
            ...next[idx],
            status: "error",
            error: "Timed out",
            endTime: Date.now(),
          };
          sessionStore.setState({ toolCalls: next });
        }
        break;
      }
      case "tool_result_received": {
        const current = sessionStore.getState().toolCalls as ToolPart[];
        const idx = current.findIndex((t) => t.id === event.toolCallId);
        if (idx >= 0) {
          const next = [...current];
          next[idx] = {
            ...next[idx],
            result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
          };
          sessionStore.setState({ toolCalls: next });
        }
        break;
      }
      case "permission_requested":
        sessionStore.setState({
          permissionRequest: {
            id: event.requestId as string,
            tool: event.toolName as string,
            args: event.args as Record<string, unknown>,
          },
        });
        break;
      case "permission_granted":
      case "permission_denied":
        sessionStore.setState({ permissionRequest: null });
        break;
      case "agent_loop_completed": {
        const text = sessionStore.getState().streamingText;
        if (text && !sessionStore.getState().messages.some((m: { role: string }) => m.role === "assistant")) {
          sessionStore.setState({
            streamingText: "",
            messages: [...sessionStore.getState().messages, { role: "assistant" as const, content: text }],
          });
        }
        break;
      }
      case "agent_loop_failed":
        sessionStore.setState({ sessionState: "error" as SessionState });
        break;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sse as any).on(sessionId, handler);

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sse as any).off(sessionId, handler);
  };
}
