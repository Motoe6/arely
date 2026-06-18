import type { SwarmTaskCategory, Complexity } from "./manager-types.js";

/** Status of a single manager node in the tree. */
export type ManagerNodeStatus =
  | "idle"
  | "planning"
  | "running"
  | "completed"
  | "failed";

/** A role assignment for a leaf manager node (the actual agent work). */
export interface RoleAssignment {
  roleId: string;
  role: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  task: string;
  context?: string;
}

/** A single node in the manager hierarchy tree. */
export interface ManagerNode {
  id: string;
  name: string;
  category: SwarmTaskCategory;
  status: ManagerNodeStatus;
  children: ManagerNode[];
  assignments: RoleAssignment[];
  goal: string;
  depth: number;
  output?: string;
  error?: string;
  durationMs?: number;
  replanCount: number;
}

/** Complete tree structure for a hierarchical swarm execution. */
export interface ManagerTree {
  root: ManagerNode;
  nodes: Map<string, ManagerNode>;
  sessionId: string;
  goal: string;
  maxDepth: number;
}

/** Result of executing the full hierarchical tree. */
export interface HierarchicalResult {
  sessionId: string;
  goal: string;
  root: ManagerNode;
  success: boolean;
  durationMs: number;
  errors: string[];
  memoryIds: string[];
}

/** Options for the hierarchical planner. */
export interface HierarchicalPlannerOptions {
  sessionId: string;
  goal: string;
  maxDepth?: number;
  maxNodes?: number;
  preferFast?: boolean;
}

/** Options for the hierarchical executor. */
export interface HierarchicalExecutorOptions {
  execute: (role: string, systemPrompt: string, task: string, context: string, modelId?: string) => Promise<string>;
  /** Optional Coordinator for distributed execution. When set, leaf nodes dispatch to remote workers. */
  coordinator?: {
    runSwarm(
      sessionId: string,
      assignments: Array<{
        roleId?: string;
        role: string;
        provider: string;
        model: string;
        systemPrompt?: string;
        task: string;
        context?: string;
      }>,
    ): Promise<{ success: boolean; outputs: Record<string, string> }>;
  };
  sessionId: string;
  storeMemory?: boolean;
  maxDepth?: number;
  recovery?: {
    maxRetries?: number;
    enableReplan?: boolean;
    enableSingleAgentFallback?: boolean;
  };
}

/** A leaf node has no children; an internal node has at least one child. */
export type NodeType = "leaf" | "internal";

export function getNodeType(node: ManagerNode): NodeType {
  return node.children.length === 0 ? "leaf" : "internal";
}

/** Collect all leaf nodes (the actual agent-execution targets). */
export function collectLeaves(node: ManagerNode): ManagerNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(collectLeaves);
}

/** Collect all internal (manager) nodes. */
export function collectManagers(node: ManagerNode): ManagerNode[] {
  const managers: ManagerNode[] = [];
  function walk(n: ManagerNode): void {
    if (n.children.length > 0) managers.push(n);
    for (const c of n.children) walk(c);
  }
  walk(node);
  return managers;
}

/** Compute the actual depth of a tree (max depth from root to deepest leaf). */
export function treeDepth(node: ManagerNode): number {
  if (node.children.length === 0) return node.depth;
  return Math.max(...node.children.map(treeDepth));
}

/** Count total nodes in the tree. */
export function countNodes(node: ManagerNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

/** Rebuild the node map from a root node. */
export function buildNodeMap(root: ManagerNode): Map<string, ManagerNode> {
  const map = new Map<string, ManagerNode>();
  function walk(n: ManagerNode): void {
    map.set(n.id, n);
    for (const c of n.children) walk(c);
  }
  walk(root);
  return map;
}
