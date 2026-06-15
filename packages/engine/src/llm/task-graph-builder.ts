import type { SwarmTask, TaskGraph } from "./swarm-task-types.js";

export type { SwarmTask, TaskGraph } from "./swarm-task-types.js";

export function computePhases(tasks: SwarmTask[]): string[][] {
  const phases: string[][] = [];
  const remaining = new Set(tasks.map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  while (remaining.size > 0) {
    const batch: string[] = [];
    for (const id of remaining) {
      const task = taskMap.get(id)!;
      if (task.dependencies.every((d) => !remaining.has(d))) {
        batch.push(id);
      }
    }
    if (batch.length === 0) {
      throw new Error(
        `Circular dependency detected among: ${[...remaining].join(", ")}`,
      );
    }
    phases.push(batch);
    for (const id of batch) remaining.delete(id);
  }

  return phases;
}

export class TaskGraphBuilder {
  build(plan: string, request: string): TaskGraph {
    const tasks: SwarmTask[] = [
      {
        id: "researcher-a",
        role: "researcher",
        goal: "Research best practices and approaches for the task",
        dependencies: [],
        instructions: `Plan:\n${plan}\n\nRequest:\n${request}`,
      },
      {
        id: "researcher-b",
        role: "researcher",
        goal: "Identify edge cases, risks, and failure modes",
        dependencies: [],
        instructions: `Plan:\n${plan}\n\nRequest:\n${request}`,
      },
      {
        id: "coder",
        role: "coder",
        goal: "Implement the solution following the plan",
        dependencies: [],
        instructions: `Plan:\n${plan}\n\nRequest:\n${request}`,
      },
      {
        id: "reviewer",
        role: "reviewer",
        goal: "Review all outputs for correctness, security, and quality",
        dependencies: ["researcher-a", "researcher-b", "coder"],
        instructions: "",
      },
      {
        id: "synthesizer",
        role: "synthesizer",
        goal: "Merge all outputs into a final coherent response",
        dependencies: ["reviewer"],
        instructions: "",
      },
    ];

    const phases = computePhases(tasks);
    return { tasks, phases };
  }
}

export const taskGraphBuilder = new TaskGraphBuilder();
