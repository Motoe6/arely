"use client";

import { useEffect, useRef, useState } from "react";
import { sessionStore } from "@arely/ui-core/stores/session-store";
import { appStore } from "@arely/ui-core/stores/app-store";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

function findToolCall(toolCallId: string) {
  const { toolCalls } = sessionStore.getState();
  return toolCalls.find((tc: any) => tc.id === toolCallId);
}

export function useSSE(sessionId: string | null) {
  const [connected, setConnected] = useState(false);
  const lastSeqRef = useRef<string>("");

  useEffect(() => {
    if (!sessionId) {
      setConnected(false);
      return;
    }

    const url = `${ENGINE_URL}/api/sse?sessionId=${sessionId}`;
    const es = new EventSource(url);

    es.onopen = () => {
      setConnected(true);
      appStore.setState({ isEngineRunning: true });
    };

    es.onerror = () => {
      setConnected(false);
    };

    es.addEventListener("connected", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        lastSeqRef.current = String(d.replayed ?? 0);
        setConnected(true);
      } catch { /* ignore */ }
    });

    es.onmessage = (e: MessageEvent) => {
      lastSeqRef.current = e.lastEventId;
      try {
        const event = JSON.parse(e.data);
        handleEvent(event);
      } catch { /* ignore */ }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [sessionId]);
}

function handleEvent(event: any) {
  switch (event.type) {
    case "session_started":
      appStore.setState({ sessionId: event.sessionId });
      sessionStore.setState({
        sessionState: "running",
        messages: [{ role: "user", content: event.query }],
        streamingText: "",
        isThinking: false,
      });
      break;

    case "session_state_change":
      sessionStore.setState({ sessionState: event.state });
      if (event.state === "completed" || event.state === "error") {
        sessionStore.setState({ isThinking: false, streamingText: "" });
      }
      break;

    case "session_thinking":
      sessionStore.setState({ isThinking: true });
      break;

    case "session_completed":
      sessionStore.setState({ sessionState: "completed", isThinking: false, streamingText: "" });
      break;

    case "assistant_message_created":
      sessionStore.setState({ streamingText: "", isThinking: false });
      break;

    case "assistant_message_stream_delta": {
      const s = sessionStore.getState();
      sessionStore.setState({ streamingText: s.streamingText + event.delta });
      break;
    }

    case "assistant_message_completed": {
      const s = sessionStore.getState();
      sessionStore.setState({
        messages: [...s.messages, { role: "assistant", content: event.content }],
        streamingText: "",
      });
      break;
    }

    case "tool_call_pending": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: [...s.toolCalls, {
          id: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "pending",
        }],
      });
      break;
    }

    case "tool_call_started": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId ? { ...tc, status: "running", startTime: Date.now() } : tc
        ),
      });
      break;
    }

    case "tool_call_progress": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId ? { ...tc, progress: event.progress } : tc
        ),
      });
      break;
    }

    case "tool_call_completed": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId
            ? { ...tc, status: "completed", result: event.result, endTime: Date.now(), durationMs: event.durationMs }
            : tc
        ),
      });
      break;
    }

    case "tool_call_failed": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId
            ? { ...tc, status: "error", error: event.error, endTime: Date.now() }
            : tc
        ),
      });
      break;
    }

    case "tool_call_timed_out": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId
            ? { ...tc, status: "error", error: "Timed out", endTime: Date.now() }
            : tc
        ),
      });
      break;
    }

    case "tool_call_cancelled": {
      const s = sessionStore.getState();
      sessionStore.setState({
        toolCalls: s.toolCalls.map((tc: any) =>
          tc.id === event.toolCallId
            ? { ...tc, status: "error", error: event.reason || "Cancelled", endTime: Date.now() }
            : tc
        ),
      });
      break;
    }

    case "tool_result_received":
      break;

    case "permission_requested":
      sessionStore.setState({
        permissionRequest: { id: event.requestId, tool: event.toolName, args: event.args },
      });
      break;

    case "permission_granted":
    case "permission_denied":
      sessionStore.setState({ permissionRequest: null });
      break;

    case "agent_loop_completed":
      sessionStore.setState({ sessionState: "completed", isThinking: false });
      break;

    case "agent_loop_failed":
      sessionStore.setState({ sessionState: "error", isThinking: false, error: event.error });
      break;

    default:
      break;
  }
}