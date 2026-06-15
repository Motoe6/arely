"use client";

import { useCallback, useState } from "react";
import { sessionStore } from "@arely/ui-core/stores/session-store";
import { appStore } from "@arely/ui-core/stores/app-store";
import { useSSE } from "./useSSE";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8081";

export function useEngine() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSSE(sessionId);

  const healthCheck = useCallback(async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const ok = res.ok;
      appStore.setState({ isEngineRunning: ok });
      return ok;
    } catch {
      appStore.setState({ isEngineRunning: false });
      return false;
    }
  }, []);

  const send = useCallback(async (prompt: string) => {
    setError(null);
    sessionStore.setState({
      sessionState: "running",
      messages: [{ role: "user", content: prompt }],
      toolCalls: [],
      streamingText: "",
      isThinking: false,
      permissionRequest: null,
    });

    try {
      const res = await fetch(`${ENGINE_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: prompt, mode: appStore.getState().agentMode === "swarm" ? "swarm" : appStore.getState().agentMode === "planner" ? "planning" : "agent" }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Engine error (${res.status}): ${body}`);
      }

      const data = await res.json();
      setSessionId(data.id);
      appStore.setState({ sessionId: data.id, model: data.model || appStore.getState().model });
    } catch (err: any) {
      setError(err.message);
      sessionStore.setState({
        sessionState: "error",
        messages: [],
        streamingText: "",
        isThinking: false,
        toolCalls: [],
      });
    }
  }, []);

  const cancel = useCallback(async () => {
    const sid = sessionId || appStore.getState().sessionId;
    if (!sid) return;
    try {
      await fetch(`${ENGINE_URL}/api/sessions/${sid}/cancel`, { method: "POST" });
    } catch { /* best effort */ }
    sessionStore.setState({ sessionState: "completed", isThinking: false });
  }, [sessionId]);

  return { send, cancel, healthCheck, sessionId, error };
}