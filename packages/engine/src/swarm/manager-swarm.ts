import { ulid } from "ulid";
import type { AgentExecutor, HeterogeneousExecutor } from "../llm/swarm-orchestrator.js";
import type { AgentRole } from "../llm/swarm-types.js";
import type { SwarmAgentRole } from "../llm/swarm-task-types.js";
import { ManagerPlanner, managerPlanner as defaultPlanner, computePhases } from "./manager-planner.js";
import type {
  ManagerTask,
  TaskPlan,
  SubSwarmResult,
  ManagerResult,
  SwarmTaskCategory,
  ManagerRecoveryOptions,
} from "./manager-types.js";
import { DEFAULT_RECOVERY_OPTIONS } from "./manager-types.js";

export interface ManagerSwarmOptions {
  execute: HeterogeneousExecutor | AgentExecutor;
  planner?: ManagerPlanner;
  roleMap?: Map<string, { provider: string; model: string }>;
  recovery?: Partial<ManagerRecoveryOptions>;
  storeMemory?: boolean;
  sessionId: string;
}

function categoryToRole(category: SwarmTaskCategory): SwarmAgentRole {
  switch (category) {
    case "research": return "researcher";
    case "coding": return "coder";
    case "analysis": return "researcher";
    case "writing": return "synthesizer";
  }
}

const SUB_SWARM_SYSTEM_PROMPTS: Record<SwarmTaskCategory, string> = {
  research: `You are a research agent. Investigate thoroughly. Provide facts, analysis, and sources.`,
  coding: `You are a coding agent. Implement correct, clean, well-documented solutions.`,
  analysis: `You are an analysis agent. Compare, evaluate, and synthesize information. Provide clear reasoning.`,
  writing: `You are a writer. Produce clear, professional, well-structured final content.`,
};

function createAgentExecutor(
  llm: HeterogeneousExecutor | AgentExecutor,
): HeterogeneousExecutor {
  return llm as HeterogeneousExecutor;
}

export class ManagerSwarm {
  private llmExecute: HeterogeneousExecutor;
  private planner: ManagerPlanner;
  private sessionId: string;
  private roleMap?: Map<string, { provider: string; model: string }>;
  private recovery: ManagerRecoveryOptions;
  private storeMemory: boolean;

  constructor(opts: ManagerSwarmOptions) {
    this.llmExecute = createAgentExecutor(opts.execute);
    this.planner = opts.planner ?? defaultPlanner;
    this.sessionId = opts.sessionId;
    this.roleMap = opts.roleMap;
    this.recovery = { ...DEFAULT_RECOVERY_OPTIONS, ...opts.recovery };
    this.storeMemory = opts.storeMemory ?? true;
  }

  async execute(goal: string): Promise<ManagerResult> {
    const startTime = Date.now();
    const plan = this.planner.createPlan({ sessionId: this.sessionId, goal });
    const phases = computePhases(plan.tasks);
    const subResults: SubSwarmResult[] = [];
    const memoryIds: string[] = [];

    for (const batch of phases) {
      const batchResults = await Promise.all(
        batch.map(async (taskId) => {
          const task = plan.tasks.find((t) => t.taskId === taskId)!;
          return this.executeTaskWithRecovery(task, goal, subResults, 0);
        }),
      );
      subResults.push(...batchResults);
    }

    const synthesis = await this.synthesize(goal, subResults);

    const errors = subResults.filter((r) => r.error).map((r) => r.error!);
    let stored = false;
    if (this.storeMemory) {
      const memoryId = await this.storeInMemory(goal, plan, subResults, synthesis);
      if (memoryId) {
        stored = true;
        memoryIds.push(memoryId);
      }
    }

    return {
      sessionId: this.sessionId,
      goal,
      plan,
      subResults,
      synthesis,
      durationMs: Date.now() - startTime,
      memoryIds,
      success: errors.length === 0,
      stored,
      errors,
    };
  }

  private async executeTaskWithRecovery(
    task: ManagerTask,
    goal: string,
    priorResults: SubSwarmResult[],
    attempt: number,
  ): Promise<SubSwarmResult> {
    try {
      return await this.executeSubSwarm(task, goal, priorResults);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (attempt < this.recovery.maxRetries) {
        return this.executeTaskWithRecovery(task, goal, priorResults, attempt + 1);
      }

      // All retries exhausted, try fallbacks
      if (this.recovery.enableSingleAgentFallback) {
        const fallbackResult = await this.executeSingleAgent(task, goal, priorResults);
        if (fallbackResult) return fallbackResult;
      }

      return {
        taskId: task.taskId,
        category: task.category,
        output: `Failed after ${attempt + 1} attempts: ${errorMessage}`,
        durationMs: 0,
        assignments: [],
        error: errorMessage,
      };
    }
  }

  private async executeSubSwarm(
    task: ManagerTask,
    goal: string,
    priorResults: SubSwarmResult[],
  ): Promise<SubSwarmResult> {
    const startTime = Date.now();
    const context = this.buildContext(task, priorResults);
    const systemPrompt = SUB_SWARM_SYSTEM_PROMPTS[task.category];

    const output = await this.llmExecute(
      categoryToRole(task.category) as AgentRole,
      systemPrompt,
      task.description,
      context,
    );

    return {
      taskId: task.taskId,
      category: task.category,
      output,
      durationMs: Date.now() - startTime,
      assignments: [],
    };
  }

  private async executeSingleAgent(
    task: ManagerTask,
    goal: string,
    priorResults: SubSwarmResult[],
  ): Promise<SubSwarmResult | null> {
    try {
      const startTime = Date.now();
      const systemPrompt = SUB_SWARM_SYSTEM_PROMPTS[task.category];
      const context = this.buildContext(task, priorResults);
      const modelId = `${this.recovery.fallbackProvider}:${this.recovery.fallbackModel}`;

      const output = await this.llmExecute(
        "coder" as AgentRole,
        systemPrompt,
        task.description,
        context,
        modelId,
      );

      return {
        taskId: task.taskId,
        category: task.category,
        output,
        durationMs: Date.now() - startTime,
        assignments: [{ role: "fallback", provider: this.recovery.fallbackProvider, model: this.recovery.fallbackModel }],
      };
    } catch {
      return null;
    }
  }

  private buildContext(task: ManagerTask, priorResults: SubSwarmResult[]): string {
    const depResults = priorResults.filter((r) => task.dependencies.includes(r.taskId));
    if (depResults.length === 0) return "";
    return depResults.map((r) => `=== ${r.taskId}: ${r.category} ===\n${r.output}`).join("\n\n");
  }

  private async synthesize(goal: string, results: SubSwarmResult[]): Promise<string> {
    const successful = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    if (successful.length === 0) {
      return `All sub-swarms failed for goal: ${goal}`;
    }

    const outputBlocks = successful.map(
      (r) => `[${r.taskId} — ${r.category}]\n${r.output}`,
    );
    const failuresNote = failed.length > 0
      ? `\n\nNote: ${failed.length} sub-swarm(s) failed and were excluded.`
      : "";

    const systemPrompt = `You are a synthesis agent. Combine all sub-swarm outputs into a single coherent final response. Resolve contradictions and highlight key findings.`;
    const context = outputBlocks.join("\n\n---\n\n") + failuresNote;

    return this.llmExecute(
      "synthesizer" as AgentRole,
      systemPrompt,
      `Synthesize results for goal: ${goal}`,
      context,
    );
  }

  private async storeInMemory(
    goal: string,
    plan: TaskPlan,
    results: SubSwarmResult[],
    synthesis: string,
  ): Promise<string> {
    try {
      const { crossSessionMemory } = await import("@arelyos/memory");
      const mem = await crossSessionMemory.store({
        content: `Manager Swarm — ${goal}\n\nPlan: ${plan.tasks.map((t) => `${t.taskId}: ${t.title}`).join(", ")}\n\nSynthesis:\n${synthesis}`,
        sessionId: this.sessionId,
        tags: ["manager-swarm", ...plan.tasks.map((t) => t.category)],
        importance: 0.9,
        confidence: 80,
      });
      return mem.id;
    } catch {
      return "";
    }
  }
}
