import type { AgentMode } from "../types/index.js";
import { appStore } from "../stores/app-store.js";

export function getAvailableModes(): { id: AgentMode; label: string }[] {
  return [
    { id: "single", label: "Single Agent" },
    { id: "planner", label: "Planner" },
    { id: "swarm", label: "Swarm" },
    { id: "shared-memory", label: "Shared Memory Swarm" },
    { id: "manager", label: "Manager Swarm" },
  ];
}

export function changeMode(mode: AgentMode): void {
  appStore.setState({ agentMode: mode });
}
