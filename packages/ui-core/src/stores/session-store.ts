import { createStore } from "./app-store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolCallPart = any;
export type PermissionRequest = { id: string; tool: string; args: Record<string, unknown> } | null;
export type SessionState = "idle" | "running" | "completed" | "error";

export interface SessionStateData {
  messages: SessionMessage[];
  toolCalls: ToolCallPart[];
  permissionRequest: PermissionRequest;
  sessionState: SessionState;
  streamingText: string;
  isThinking: boolean;
  error?: string | null;
}

export function createDefaultSessionState(): SessionStateData {
  return {
    messages: [],
    toolCalls: [],
    permissionRequest: null,
    sessionState: "idle",
    streamingText: "",
    isThinking: false,
    error: null,
  };
}

export const sessionStore = createStore(createDefaultSessionState());
