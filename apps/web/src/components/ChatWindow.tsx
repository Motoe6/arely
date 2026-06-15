"use client";

import React from "react";
import { sessionStore } from "@arely/ui-core/stores/session-store";
import { ToolCallCard } from "./ToolCallCard";

export function ChatWindow() {
  const [, forceUpdate] = React.useState(0);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const unsub = sessionStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => { unsub(); };
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const { messages, toolCalls, streamingText, sessionState, isThinking } = sessionStore.getState();

  const runningTools = toolCalls.filter((t: { status: string }) => t.status === "running" || t.status === "pending");
  const completedTools = toolCalls.filter((t: { status: string }) => t.status === "completed" || t.status === "error");

  return (
    <>
      {messages.length === 0 && sessionState === "idle" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555", fontSize: 13 }}>
          Type a query and press Enter to start.
        </div>
      )}

      {messages.map((m: { role: string; content?: string }, i: number) => (
        m.role === "user" ? (
          <div key={i} className="message">
            <div className="message-avatar user">You</div>
            <div className="message-content">{m.content}</div>
          </div>
        ) : m.role === "assistant" && m.content ? (
          <div key={i} className="message">
            <div className="message-avatar assistant">ARE LY</div>
            <div className="message-content">{m.content}</div>
          </div>
        ) : null
      ))}

      {/* Running tool calls */}
      {runningTools.length > 0 && (
        <div className="tool-card">
          {runningTools.map((tc: any) => <ToolCallCard key={tc.id} part={tc} />)}
        </div>
      )}

      {/* Completed tool calls */}
      {completedTools.length > 0 && (
        <div className="tool-card">
          {completedTools.map((tc: any) => <ToolCallCard key={tc.id} part={tc} />)}
        </div>
      )}

      {/* Thinking indicator */}
      {isThinking && !streamingText && (
        <div className="thinking">
          <div className="message-avatar assistant">ARE LY</div>
          <div className="thinking-dots">
            <div className="thinking-dot" />
            <div className="thinking-dot" />
            <div className="thinking-dot" />
          </div>
        </div>
      )}

      {/* Streaming text */}
      {streamingText && sessionState === "running" && (
        <div className="streaming">
          <div className="message-avatar assistant">ARE LY</div>
          <div>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {streamingText.slice(0, 2000)}
            </span>
            <span className="streaming-cursor" style={{ color: "#00ff88" }}>▌</span>
          </div>
        </div>
      )}

      {sessionState === "completed" && messages.filter((m: { role: string }) => m.role === "assistant").length > 0 && (
        <div style={{ color: "#00cc66", fontSize: 12, paddingLeft: 60 }}>✓ Response complete</div>
      )}

      {sessionState === "error" && (
        <div style={{ color: "#ff4444", fontSize: 12, paddingLeft: 60 }}>✗ Session failed</div>
      )}

      <div ref={bottomRef} />
    </>
  );
}
