import type { AgentContribution, SwarmAgentRole } from "./swarm-task-types.js";

export type { AgentContribution } from "./swarm-task-types.js";

export class SharedSwarmMemory {
  private contributions: AgentContribution[] = [];
  private injected: string[] = [];

  inject(section: string): void {
    this.injected.push(section);
  }

  write(role: SwarmAgentRole, taskId: string, content: string): void {
    this.contributions.push({ role, taskId, content, timestamp: Date.now() });
  }

  readAll(): string {
    const parts: string[] = [];
    for (const section of this.injected) {
      if (section) parts.push(section);
    }
    for (const c of this.contributions) {
      parts.push(`[${c.role} / ${c.taskId}]\n${c.content}`);
    }
    return parts.join("\n\n---\n\n");
  }

  getContributionsByRole(role: SwarmAgentRole): AgentContribution[] {
    return this.contributions.filter((c) => c.role === role);
  }

  getAllContributions(): AgentContribution[] {
    return [...this.contributions];
  }

  clear(): void {
    this.contributions = [];
    this.injected = [];
  }
}
