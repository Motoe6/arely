import type { AgentExecutor } from "./swarm-orchestrator.js";
import type { ParallelSwarmResult, SharedMemoryOptions, AgentContribution } from "./swarm-task-types.js";
import { TaskGraphBuilder, taskGraphBuilder as defaultBuilder } from "./task-graph-builder.js";
import { SwarmTaskExecutor, getSystemPrompt } from "./swarm-executor.js";
import { SharedSwarmMemory } from "./shared-swarm-memory.js";

const PLANNER_PROMPT = getSystemPrompt("planner");

export type { ParallelSwarmResult, SharedMemoryOptions, AgentContribution } from "./swarm-task-types.js";

export interface RoleModelMap {
  [role: string]: { provider: string; model: string };
}

export class ParallelSwarmOrchestrator {
  private taskExecutor: SwarmTaskExecutor;
  private graphBuilder: TaskGraphBuilder;

  constructor(
    execute: AgentExecutor,
    deps?: { graphBuilder?: TaskGraphBuilder; roleMap?: Map<string, { provider: string; model: string }> },
  ) {
    this.taskExecutor = new SwarmTaskExecutor(execute, deps?.roleMap);
    this.graphBuilder = deps?.graphBuilder ?? defaultBuilder;
  }

  async run(request: string, memoryOptions?: SharedMemoryOptions): Promise<ParallelSwarmResult> {
    const plan = await this.taskExecutor.run(
      { id: "planner", role: "planner", goal: "Create a plan", dependencies: [], instructions: request },
      "",
      request,
    );

    const sharedMemory = new SharedSwarmMemory();
    if (memoryOptions?.goalResume) sharedMemory.inject(`[Goal Resume]\n${memoryOptions.goalResume}`);
    if (memoryOptions?.relevantMemories) sharedMemory.inject(`[Relevant Memories]\n${memoryOptions.relevantMemories}`);
    if (memoryOptions?.decisionHistory) sharedMemory.inject(`[Decision History]\n${memoryOptions.decisionHistory}`);
    if (memoryOptions?.customContext) sharedMemory.inject(memoryOptions.customContext);

    const graph = this.graphBuilder.build(plan, request);
    const outputs: Record<string, string> = {};

    for (const batch of graph.phases) {
      const results = await Promise.all(
        batch.map(async (taskId) => {
          const task = graph.tasks.find((t) => t.id === taskId)!;
          const output = await this.taskExecutor.runWithSharedMemory(task, request, outputs, sharedMemory);
          return { taskId, output };
        }),
      );
      for (const r of results) {
        outputs[r.taskId] = r.output;
      }
    }

    return {
      request,
      plan,
      tasks: graph.tasks,
      outputs,
      review: outputs["reviewer"] ?? "",
      synthesis: outputs["synthesizer"] ?? "",
      contributions: sharedMemory.getAllContributions(),
    };
  }
}
