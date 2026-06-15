import type { AgentMode, ModelDefinition } from "../types/index.js";

export interface AppState {
  provider: string;
  model: string;
  agentMode: AgentMode;
  sessionId: string | null;
  models: ModelDefinition[];
  isEngineRunning: boolean;
  username: string;
}

export function createDefaultAppState(): AppState {
  return {
    provider: "ollama",
    model: "",
    agentMode: "single",
    sessionId: null,
    models: [],
    isEngineRunning: false,
    username: "User",
  };
}

// Simple pub-sub store shared between Ink and React DOM
type Listener = () => void;

export function createStore<T>(initial: T) {
  let state = { ...initial };
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (partial: Partial<T>) => {
      state = { ...state, ...partial };
      listeners.forEach((l) => l());
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appStore = createStore(createDefaultAppState());
