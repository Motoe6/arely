import { ulid } from "ulid";
import type { ManagerTask, TaskPlan, SwarmTaskCategory, Complexity } from "./manager-types.js";
import { CATEGORY_PRIORITY, COMPLEXITY_WEIGHT } from "./manager-types.js";

export interface PlannerOptions {
  sessionId: string;
  goal: string;
  context?: string;
  preferFast?: boolean;
}

function inferCategories(goal: string): SwarmTaskCategory[] {
  const lower = goal.toLowerCase();
  const cats: SwarmTaskCategory[] = [];

  if (/\b(research|investigate|study|analyze|find|search|explore|survey)\b/.test(lower)) {
    cats.push("research");
  }
  if (/\b(code|implement|build|develop|program|write\s.+(function|class|api|app|script|module))\b/.test(lower)) {
    cats.push("coding");
  }
  if (/\b(analy(s|z)e|compare|evaluate|assess|review|audit|benchmark)\b/.test(lower)) {
    cats.push("analysis");
  }
  if (/\b(write|document|report|draft|summarize|synthesize|explain|describe)\b/.test(lower)) {
    cats.push("writing");
  }
  if (cats.length === 0) {
    cats.push("research", "analysis", "writing");
  }
  return cats;
}

function decideComplexity(goal: string): Complexity {
  const lower = goal.toLowerCase();
  const complexWords = /\b(complex|large|distributed|multi|scale|enterprise|advanced|comprehensive)\b/;
  const high = (lower.match(complexWords) || []).length;
  if (high >= 2) return "high";
  if (high >= 1) return "medium";
  return "low";
}

export function computePhases(tasks: ManagerTask[]): string[][] {
  const phases: string[][] = [];
  const remaining = new Set(tasks.map((t) => t.taskId));
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  while (remaining.size > 0) {
    const batch: string[] = [];
    for (const id of remaining) {
      const task = taskMap.get(id)!;
      if (task.dependencies.every((d) => !remaining.has(d))) {
        batch.push(id);
      }
    }
    if (batch.length === 0) {
      throw new Error(`Circular dependency detected among: ${[...remaining].join(", ")}`);
    }
    phases.push(batch);
    for (const id of batch) remaining.delete(id);
  }
  return phases;
}

export class ManagerPlanner {
  createPlan(opts: PlannerOptions): TaskPlan {
    const categories = inferCategories(opts.goal);
    const complexity = opts.preferFast ? "low" : decideComplexity(opts.goal);
    const tasks = this.buildTasks(opts.goal, categories, complexity);
    return { planId: ulid(), sessionId: opts.sessionId, tasks, createdAt: Date.now() };
  }

  private buildTasks(goal: string, categories: SwarmTaskCategory[], complexity: Complexity): ManagerTask[] {
    const tasks: ManagerTask[] = [];
    const catSet = new Set(categories);
    let index = 0;

    if (catSet.has("research")) {
      tasks.push(this.makeTask(++index, `Research`, `Investigate and gather information about: ${goal}`, "research", []));
    }

    if (catSet.has("analysis")) {
      const deps = tasks.filter((t) => t.category === "research").map((t) => t.taskId);
      tasks.push(this.makeTask(++index, `Analyze`, `Analyze findings and identify patterns, trade-offs, and recommendations for: ${goal}`, "analysis", deps));
    }

    if (catSet.has("coding")) {
      const deps = tasks.filter((t) => t.category === "research" || t.category === "analysis").map((t) => t.taskId);
      tasks.push(this.makeTask(++index, `Implement`, `Implement the solution for: ${goal}`, "coding", deps));
    }

    {
      const deps = tasks.map((t) => t.taskId);
      tasks.push(this.makeTask(++index, `Synthesize`, `Synthesize all outputs into a coherent final response for: ${goal}`, "writing", deps));
    }

    const priorityOffset = 0;
    for (const t of tasks) {
      t.priority = priorityOffset + CATEGORY_PRIORITY[t.category] * 10 + COMPLEXITY_WEIGHT[complexity] * index;
    }

    return tasks;
  }

  private makeTask(index: number, title: string, description: string, category: SwarmTaskCategory, dependencies: string[]): ManagerTask {
    return {
      taskId: `T${index}`,
      title,
      description,
      category,
      dependencies,
      priority: 0,
      estimatedComplexity: "medium",
    };
  }
}

export const managerPlanner = new ManagerPlanner();
