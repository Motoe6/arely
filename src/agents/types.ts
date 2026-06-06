export type AgentTrigger = "manual" | "interval" | "pipeline";

export interface AgentRecord {
  id: string;
  name: string;
  description: string | null;
  goal: string;
  mode: "planning";
  trigger: AgentTrigger;
  triggerConfig: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AgentDefinition = Omit<AgentRecord, "createdAt" | "updatedAt">;
