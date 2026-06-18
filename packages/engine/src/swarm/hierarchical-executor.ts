import { ulid } from "ulid";
import { hierarchicalPlanner as defaultPlanner } from "./hierarchical-planner.js";
import type { HierarchicalPlanner } from "./hierarchical-planner.js";
import type {
  ManagerNode,
  ManagerTree,
  HierarchicalResult,
  HierarchicalExecutorOptions,
} from "./hierarchical-types.js";
import { getNodeType, countNodes } from "./hierarchical-types.js";
import { tracer } from "../tracer.js";
import { metrics } from "../metrics.js";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_RETRIES = 1;

/**
 * Recursively execute a manager tree.
 *
 * For each internal node: run children in parallel, then synthesize.
 * For each leaf node: execute the role assignment via LLM.
 *
 * When a Coordinator is provided, manager nodes may be dispatched
 * to remote workers for distributed execution.
 */
export class HierarchicalSwarmExecutor {
  private llmExecute: HierarchicalExecutorOptions["execute"];
  private planner: HierarchicalPlanner;
  private coordinator?: HierarchicalExecutorOptions["coordinator"];
  private sessionId: string;
  private storeMemory: boolean;
  private maxDepth: number;
  private recovery: Required<NonNullable<HierarchicalExecutorOptions["recovery"]>>;

  constructor(opts: HierarchicalExecutorOptions) {
    this.llmExecute = opts.execute;
    this.planner = defaultPlanner;
    this.coordinator = opts.coordinator;
    this.sessionId = opts.sessionId;
    this.storeMemory = opts.storeMemory ?? true;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.recovery = {
      maxRetries: opts.recovery?.maxRetries ?? DEFAULT_RETRIES,
      enableReplan: opts.recovery?.enableReplan ?? true,
      enableSingleAgentFallback: opts.recovery?.enableSingleAgentFallback ?? true,
    };
  }

  async execute(goal: string): Promise<HierarchicalResult> {
    const startTime = Date.now();
    const span = tracer.startSpan(
      `hierarchical-${ulid().slice(0, 8)}`,
      "hierarchical.execute",
    );

    const tree = this.planner.createTree({
      sessionId: this.sessionId,
      goal,
      maxDepth: this.maxDepth,
    });

    tracer.endSpan(span, {
      "hierarchical.session_id": this.sessionId,
      "hierarchical.goal": goal,
      "hierarchical.node_count": String(countNodes(tree.root)),
      "hierarchical.max_depth": String(this.maxDepth),
    });

    metrics.increment("hierarchical_executions_total", { sessionId: this.sessionId });

    // Execute the root tree recursively
    const rootResult = await this.executeNode(tree.root, goal);

    // Collect all errors across the tree
    const allErrors = this.collectErrors(tree.root);
    const success = allErrors.length === 0;

    metrics.increment(success ? "hierarchical_success_total" : "hierarchical_failure_total", { sessionId: this.sessionId });

    let memoryIds: string[] = [];
    if (this.storeMemory) {
      const mid = await this.storeInMemory(goal, tree, rootResult.output || "");
      if (mid) memoryIds = [mid];
    }

    tracer.endSpan(span, {
      "hierarchical.success": String(success),
      "hierarchical.duration_ms": String(Date.now() - startTime),
    });

    return {
      sessionId: this.sessionId,
      goal,
      root: rootResult,
      success,
      durationMs: Date.now() - startTime,
      errors: allErrors,
      memoryIds,
    };
  }

  private async executeNode(node: ManagerNode, goal: string): Promise<ManagerNode> {
    node.status = "running";
    const span = tracer.startSpan(
      `hierarchical-${ulid().slice(0, 8)}`,
      `node.${node.name}`,
    );

    try {
      if (getNodeType(node) === "leaf") {
        // Execute leaf node: run role assignments
        const results = await this.executeAssignments(node.assignments);
        node.output = results.join("\n\n---\n\n");
        node.durationMs = 0; // computed from assignments
        node.status = "completed";
      } else {
        // Execute internal node: run children in parallel, then synthesize
        const childResults = await Promise.all(
          node.children.map((child) => this.executeNode(child, node.goal)),
        );

        node.children = childResults;
        node.output = await this.synthesizeChildren(node, childResults);
        node.durationMs = childResults.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
        node.status = "completed";
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      node.error = errMsg;
      node.status = "failed";

      // Replan: create a fallback leaf node and retry
      if (this.recovery.enableReplan && node.replanCount < this.recovery.maxRetries) {
        node.replanCount++;
        const fallbackNode = await this.createFallbackNode(node, goal);
        return this.executeNode(fallbackNode, goal);
      }
    }

    tracer.endSpan(span, {
      "hierarchical.node_id": node.id,
      "hierarchical.node_name": node.name,
      "hierarchical.node_status": node.status,
      "hierarchical.node_depth": String(node.depth),
      "hierarchical.node_type": getNodeType(node),
    });

    return node;
  }

  /** Execute role assignments (leaf work). */
  private async executeAssignments(assignments: ManagerNode["assignments"]): Promise<string[]> {
    if (this.coordinator) {
      return this.executeDistributed(assignments);
    }
    return Promise.all(
      assignments.map((a) =>
        this.llmExecute(a.role, a.systemPrompt || "", a.task, a.context || ""),
      ),
    );
  }

  /** Dispatch leaf assignments to remote workers via Coordinator. */
  private async executeDistributed(assignments: ManagerNode["assignments"]): Promise<string[]> {
    const result = await this.coordinator!.runSwarm(this.sessionId, assignments.map((a) => ({
      roleId: a.roleId,
      role: a.role,
      provider: a.provider,
      model: a.model,
      systemPrompt: a.systemPrompt,
      task: a.task,
      context: a.context,
    })));
    if (!result.success) {
      const errs = Object.values(result.outputs).filter(Boolean).join("; ") || "unknown distributed error";
      throw new Error(`Distributed execution failed: ${errs}`);
    }
    return Object.values(result.outputs).filter(Boolean);
  }

  /** Synthesize child outputs into a single result for this manager node. */
  private async synthesizeChildren(node: ManagerNode, children: ManagerNode[]): Promise<string> {
    const successful = children.filter((c) => c.status === "completed" && c.output);
    const failed = children.filter((c) => c.status === "failed" || c.error);

    if (successful.length === 0) {
      return `[${node.name}] All children failed. Last error: ${failed[0]?.error || "unknown"}`;
    }

    const blocks = successful.map(
      (c) => `--- ${c.name} ---\n${c.output || "(no output)"}`,
    );
    const failuresNote = failed.length > 0
      ? `\n\n(Warning: ${failed.length} child node(s) failed and were excluded.)`
      : "";

    const context = blocks.join("\n\n") + failuresNote;
    const prompt = `Synthesize the following outputs from sub-agents managed by "${node.name}" into a coherent section.`;

    if (this.coordinator) {
      const result = await this.coordinator.runSwarm(this.sessionId, [{
        roleId: `${node.id}-synth`,
        role: "synthesizer",
        provider: "default",
        model: "default",
        systemPrompt: prompt,
        task: `Synthesize results for: ${node.goal}`,
        context,
      }]);
      return result.outputs?.[`${node.id}-synth`] || blocks.join("\n\n");
    }

    return this.llmExecute("synthesizer", prompt, `Synthesize results for: ${node.goal}`, context);
  }

  /** Create a fallback leaf when a manager node fails during replan. */
  private async createFallbackNode(failedNode: ManagerNode, goal: string): Promise<ManagerNode> {
    return {
      id: `${failedNode.id}-fallback`,
      name: `${failedNode.name}Fallback`,
      category: failedNode.category,
      status: "idle",
      children: [],
      assignments: [{
        roleId: `${failedNode.id}-fb`,
        role: "fallback",
        provider: "default",
        model: "default",
        systemPrompt: `You are a fallback agent for "${failedNode.name}". Complete the following task to the best of your ability.`,
        task: failedNode.goal,
        context: `Previous attempt failed: ${failedNode.error || "unknown error"}. Prior children:\n${
          failedNode.children.map((c) => `  ${c.name}: ${c.status}${c.output ? " (has output)" : ""}`).join("\n")
        }`,
      }],
      goal,
      depth: failedNode.depth,
      replanCount: failedNode.replanCount,
    };
  }

  /** Collect all error messages from the tree. */
  private collectErrors(node: ManagerNode): string[] {
    const errs: string[] = [];
    if (node.error) errs.push(`[${node.id}/${node.name}] ${node.error}`);
    for (const c of node.children) errs.push(...this.collectErrors(c));
    return errs;
  }

  /** Store the execution result in cross-session memory. */
  private async storeInMemory(
    goal: string,
    tree: ManagerTree,
    output: string,
  ): Promise<string> {
    try {
      const { crossSessionMemory } = await import("@arelyos/memory");
      const leafCount = tree.root.children.reduce(
        (sum, c) => sum + c.children.length, 0,
      );
      const mem = await crossSessionMemory.store({
        content: `Hierarchical Swarm — ${goal}\n\nNodes: ${countNodes(tree.root)} (${leafCount} leaves)\n\nOutput:\n${output.slice(0, 4000)}`,
        sessionId: this.sessionId,
        tags: ["hierarchical-swarm", ...tree.root.children.map((c) => c.category)],
        importance: 0.9,
        confidence: 80,
      });
      return mem.id;
    } catch {
      return "";
    }
  }
}
