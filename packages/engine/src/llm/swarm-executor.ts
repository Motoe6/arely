import type { SwarmTask, SwarmAgentRole } from "./swarm-task-types.js";
import type { SharedSwarmMemory } from "./shared-swarm-memory.js";
import type { AgentExecutor, AgentRole } from "./swarm-orchestrator.js";

export type { SwarmTask } from "./swarm-task-types.js";

const SYSTEM_PROMPTS: Record<SwarmAgentRole, string> = {
  planner: `You are a planning agent. Analyze the request and produce a detailed step-by-step plan.`,
  researcher: `You are a research agent. Investigate the topic thoroughly. Provide facts, analysis, and recommendations.`,
  coder: `You are a coding agent. Implement the solution. Write clean, correct code with clear reasoning.`,
  reviewer: `You are a code reviewer. Check for correctness, security, performance, and style issues. Provide specific actionable feedback.`,
  synthesizer: `You are a synthesizer. Combine all inputs into a single coherent final response. Resolve contradictions.`,
};

export function getSystemPrompt(role: SwarmAgentRole): string {
  return SYSTEM_PROMPTS[role];
}

export class SwarmTaskExecutor {
  constructor(private execute: AgentExecutor) {}

  async run(task: SwarmTask, context: string, request: string): Promise<string> {
    const prompt = getSystemPrompt(task.role);
    const fullInstructions = task.instructions || `Goal: ${task.goal}\n\nRequest: ${request}`;
    return this.execute(task.role as AgentRole, prompt, fullInstructions, context);
  }

  async runWithDependencies(
    task: SwarmTask,
    request: string,
    outputs: Record<string, string>,
  ): Promise<string> {
    const context = task.dependencies
      .map((depId) => `=== ${depId} ===\n${outputs[depId] ?? ""}`)
      .join("\n\n");
    return this.run(task, context, request);
  }

  async runWithSharedMemory(
    task: SwarmTask,
    request: string,
    outputs: Record<string, string>,
    sharedMemory: SharedSwarmMemory,
  ): Promise<string> {
    const depContext = task.dependencies
      .map((depId) => `=== ${depId} ===\n${outputs[depId] ?? ""}`)
      .join("\n\n");
    const sharedContext = sharedMemory.readAll();
    const fullContext = [depContext, sharedContext].filter(Boolean).join("\n\n--- Shared Working Memory ---\n\n");
    const output = await this.run(task, fullContext, request);
    sharedMemory.write(task.role, task.id, output);
    return output;
  }
}
