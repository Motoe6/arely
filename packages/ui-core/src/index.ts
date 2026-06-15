export { theme } from "./theme/index.js";
export type { Theme } from "./theme/index.js";

export type { AgentMode, AppStatus, StoredGoal, StoredSession, ModelDefinition } from "./types/index.js";

export { appStore, createStore, createDefaultAppState } from "./stores/app-store.js";
export type { AppState } from "./stores/app-store.js";
export { uiStore, createDefaultUIState } from "./stores/ui-store.js";
export type { UIState } from "./stores/ui-store.js";
export { sessionStore, createDefaultSessionState } from "./stores/session-store.js";
export type { SessionStateData, SessionMessage, ToolCallPart, PermissionRequest, SessionState } from "./stores/session-store.js";

export { setSessionEngine, sendMessage, cancelSession, loadSessions } from "./services/session-service.js";
export { getGoals } from "./services/goal-service.js";
export { listModels, changeModel, changeProvider } from "./services/model-service.js";
export { getAvailableModes, changeMode } from "./services/swarm-service.js";
