import { ulid } from "ulid";
import type { SwarmTaskCategory } from "./manager-types.js";
import type { ManagerNode, ManagerTree, HierarchicalPlannerOptions } from "./hierarchical-types.js";

/** Category → child manager name + sub-roles it manages. */
const MANAGER_ROLE_MAP: Record<SwarmTaskCategory, {
  managerName: string;
  subRoles: Array<{ roleId: string; name: string; description: string }>;
}> = {
  research: {
    managerName: "ResearchManager",
    subRoles: [
      { roleId: "web-researcher", name: "WebResearcher", description: "Search and gather information from web sources" },
      { roleId: "memory-analyst", name: "MemoryAnalyst", description: "Retrieve and analyze relevant past memory" },
      { roleId: "fact-checker", name: "FactChecker", description: "Verify facts and cross-reference sources" },
    ],
  },
  coding: {
    managerName: "EngineeringManager",
    subRoles: [
      { roleId: "architect", name: "Architect", description: "Design the system architecture and component structure" },
      { roleId: "coder", name: "Coder", description: "Write the implementation code" },
      { roleId: "tester", name: "Tester", description: "Write and run tests, verify correctness" },
    ],
  },
  analysis: {
    managerName: "ValidationManager",
    subRoles: [
      { roleId: "reviewer", name: "Reviewer", description: "Review outputs for quality and consistency" },
      { roleId: "security-auditor", name: "SecurityAuditor", description: "Audit for security vulnerabilities" },
      { roleId: "benchmark-evaluator", name: "BenchmarkEvaluator", description: "Evaluate performance against benchmarks" },
    ],
  },
  writing: {
    managerName: "SynthesisManager",
    subRoles: [
      { roleId: "writer", name: "Writer", description: "Draft and format the final document" },
      { roleId: "editor", name: "Editor", description: "Edit for clarity, consistency, and style" },
    ],
  },
};

/** Infer categories from goal text (mirrors manager-planner logic). */
function inferCategories(goal: string): SwarmTaskCategory[] {
  const lower = goal.toLowerCase();
  const cats: SwarmTaskCategory[] = [];

  if (/\b(research|investigate|study|find|search|explore|survey)\b/.test(lower)) {
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

/** Decide if a goal is complex enough to warrant deeper decomposition. */
function isComplexGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  const complexWords = /\b(complex|large|distributed|multi|scale|enterprise|advanced|comprehensive)\b/;
  const matches = (lower.match(complexWords) || []).length;
  return matches >= 1;
}

/** Build a leaf assignment for a sub-role. */
function makeAssignment(
  roleId: string,
  role: string,
  goal: string,
  description: string,
  context?: string,
): { roleId: string; role: string; provider: string; model: string; systemPrompt: string; task: string; context?: string } {
  return {
    roleId,
    role,
    provider: "default",
    model: "default",
    systemPrompt: `You are a ${role}. ${description}. Focus on this specific task within the broader goal.`,
    task: `${description}\n\nGoal: ${goal}`,
    context,
  };
}

/** Build the manager node for a single category at a given depth. */
function buildCategoryNode(
  category: SwarmTaskCategory,
  goal: string,
  depth: number,
  nodeIndex: () => number,
  context?: string,
): ManagerNode {
  const info = MANAGER_ROLE_MAP[category];
  const managerId = `M${nodeIndex()}`;

  const children: ManagerNode[] = info.subRoles.map((sub) => ({
    id: `L${nodeIndex()}`,
    name: sub.name,
    category,
    status: "idle" as const,
    children: [],
    assignments: [makeAssignment(sub.roleId, sub.name, goal, sub.description, context)],
    goal,
    depth: depth + 1,
    replanCount: 0,
  }));

  return {
    id: managerId,
    name: info.managerName,
    category,
    status: "idle",
    children,
    assignments: [],
    goal,
    depth,
    replanCount: 0,
  };
}

/** Recursively decompose a goal into a tree of manager nodes. */
function decomposeGoal(
  goal: string,
  sessionId: string,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  nodeCounter: { value: number },
): ManagerNode {
  const categories = inferCategories(goal);
  const nodeIndex = () => ++nodeCounter.value;

  const root: ManagerNode = {
    id: `R${nodeIndex()}`,
    name: "RootManager",
    category: "writing",
    status: "idle",
    children: [],
    assignments: [],
    goal,
    depth,
    replanCount: 0,
  };

  if (depth >= maxDepth || nodeCounter.value >= maxNodes) {
    // Can't go deeper; add a synthetic leaf that will use the flat planner
    root.children.push({
      id: `L${nodeIndex()}`,
      name: "FallbackAgent",
      category: "writing",
      status: "idle",
      children: [],
      assignments: [makeAssignment("fallback", "FallbackAgent", goal, "Complete the following task")],
      goal,
      depth: depth + 1,
      replanCount: 0,
    });
    return root;
  }

  for (const cat of categories) {
    if (nodeCounter.value >= maxNodes) break;
    const childGoal = `${goal} [${cat}]`;
    const childNode = buildCategoryNode(cat, childGoal, depth + 1, nodeIndex);

    // If goal is complex and we have depth left, recursively decompose children
    if (isComplexGoal(goal) && depth + 1 < maxDepth) {
      for (let i = 0; i < childNode.children.length; i++) {
        if (nodeCounter.value >= maxNodes) break;
        const subGoal = childNode.children[i].goal;
        const subCategories = inferCategories(subGoal).slice(0, 2);
        if (subCategories.length > 1) {
          // Replace leaf with a deeper sub-manager
          const deeperNode = buildCategoryNode(subCategories[0], subGoal, depth + 2, nodeIndex);
          childNode.children[i] = deeperNode;
        }
      }
    }

    root.children.push(childNode);
  }

  return root;
}

export class HierarchicalPlanner {
  createTree(opts: HierarchicalPlannerOptions): ManagerTree {
    const maxDepth = opts.maxDepth ?? 2;
    const maxNodes = opts.maxNodes ?? 20;
    const nodeCounter = { value: 0 };

    const root = decomposeGoal(opts.goal, opts.sessionId, 0, maxDepth, maxNodes, nodeCounter);

    const nodes = new Map<string, ManagerNode>();
    function walk(n: ManagerNode): void {
      nodes.set(n.id, n);
      for (const c of n.children) walk(c);
    }
    walk(root);

    return {
      root,
      nodes,
      sessionId: opts.sessionId,
      goal: opts.goal,
      maxDepth,
    };
  }
}

export const hierarchicalPlanner = new HierarchicalPlanner();
