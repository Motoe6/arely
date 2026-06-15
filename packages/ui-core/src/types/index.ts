export type AgentMode = "single" | "planner" | "swarm" | "shared-memory" | "manager";

export type AppStatus = "idle" | "running" | "completed" | "error";

export interface StoredGoal {
  id: string;
  title: string;
  progressPct: number;
  status: "active" | "completed" | "paused" | "abandoned";
}

export interface StoredSession {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: string;
  status: AppStatus;
}

export interface ModelDefinition {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  isDefault: boolean;
}
