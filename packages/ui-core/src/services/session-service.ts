import type { StoredSession } from "../types/index.js";
import { sessionStore } from "../stores/session-store.js";

export interface SessionEngine {
  run(query: string): Promise<void>;
  cancel(): void;
  onEvent: (handler: (event: { type: string; data: unknown }) => void) => void;
}

// Set by the consumer (cli or web) to wire the actual engine
let currentEngine: SessionEngine | null = null;

export function setSessionEngine(engine: SessionEngine | null) {
  currentEngine = engine;
}

export async function sendMessage(query: string): Promise<void> {
  if (!currentEngine) throw new Error("No active session engine");
  sessionStore.setState({ sessionState: "running", streamingText: "" });
  await currentEngine.run(query);
}

export function cancelSession(): void {
  currentEngine?.cancel();
  sessionStore.setState({ sessionState: "idle" });
}

export async function loadSessions(apiBase?: string): Promise<StoredSession[]> {
  if (apiBase) {
    const res = await fetch(`${apiBase}/api/sessions`);
    if (!res.ok) return [];
    return (await res.json()) as StoredSession[];
  }
  return [];
}
