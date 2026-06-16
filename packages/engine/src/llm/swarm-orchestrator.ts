import type { AgentRole, SwarmResult, SwarmStepResult } from "./swarm-types.js";

export type AgentExecutor = (role: AgentRole, systemPrompt: string, task: string, context: string) => Promise<string>;

export type HeterogeneousExecutor = (role: AgentRole, systemPrompt: string, task: string, context: string, modelId?: string) => Promise<string>;

export type { AgentRole, SwarmResult, SwarmStepResult } from "./swarm-types.js";

const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  planner: `You are a planning agent. Analyze the user's request and produce a clear, step-by-step plan. Break the work into logical phases. Specify what needs to be built, in what order, and any key decisions. Output only the plan.`,
  coder: `You are a coding agent. Implement the solution based on the plan provided. Write clean, well-structured code. Include necessary explanations inline. Output only the implementation.`,
  reviewer: `You are a code reviewer. Review the implementation for correctness, security, performance, and style. Identify issues and suggest improvements. Output only the review.`,
};

const ORDER: AgentRole[] = ["planner", "coder", "reviewer"];

export class SwarmOrchestrator {
  constructor(private execute: AgentExecutor) {}

  async run(request: string, roleMap?: Map<string, { provider: string; model: string }>): Promise<SwarmResult> {
    const steps: SwarmStepResult[] = [];
    let context = "";

    for (const role of ORDER) {
      const assignment = roleMap?.get(role);
      const modelId = assignment ? `${assignment.provider}:${assignment.model}` : undefined;
      const executor = this.execute as unknown as HeterogeneousExecutor;
      const output = await executor(role, SYSTEM_PROMPTS[role], request, context, modelId);
      const step: SwarmStepResult = { role, output };
      steps.push(step);
      context = output;
    }

    return {
      request,
      steps,
      plan: steps[0]?.output ?? "",
      code: steps[1]?.output ?? "",
      review: steps[2]?.output ?? "",
    };
  }
}
