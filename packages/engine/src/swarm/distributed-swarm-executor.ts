import type { Coordinator } from "@arelyos/distributed/coordinator";
import type { RoleAssignment } from "@arelyos/agent-core/swarm/index.js";
import type { SwarmAgentRole } from "../llm/swarm-task-types.js";
import type { ParallelSwarmResult } from "../llm/swarm-task-types.js";
import { getSystemPrompt } from "../llm/swarm-executor.js";

export interface DistributedSwarmExecutorOptions {
  coordinator: Coordinator;
  timeoutMs?: number;
}

export class DistributedSwarmExecutor {
  private coordinator: Coordinator;
  private timeoutMs: number;

  constructor(opts: DistributedSwarmExecutorOptions) {
    this.coordinator = opts.coordinator;
    this.timeoutMs = opts.timeoutMs ?? 60000;
  }

  async execute(
    sessionId: string,
    request: string,
    assignments: RoleAssignment[],
  ): Promise<ParallelSwarmResult> {
    const swarmId = `dist-swarm-${Date.now().toString(36)}`;

    const roleAssignments = assignments.map((a) => ({
      roleId: a.role,
      role: a.role,
      provider: a.provider,
      model: a.model,
      systemPrompt: getSystemPrompt(a.role as SwarmAgentRole),
      task: request,
    }));

    const result = await this.coordinator.runSwarm(
      sessionId,
      roleAssignments,
      this.timeoutMs,
    );

    const outputs: Record<string, string> = {};
    for (const rr of result.roleResults) {
      if (rr.output) {
        outputs[rr.role] = rr.output;
      }
    }

    return {
      request,
      plan: "",
      tasks: assignments.map((a) => ({
        id: a.role,
        role: a.role as SwarmAgentRole,
        goal: request,
        dependencies: [],
        instructions: request,
      })),
      outputs,
      review: outputs["reviewer"] ?? "",
      synthesis: outputs["synthesizer"] ?? "",
      contributions: [],
    };
  }
}
