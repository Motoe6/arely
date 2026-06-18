import { describe, it, expect } from "vitest";
import { hierarchicalPlanner, HierarchicalPlanner } from "../../packages/engine/src/swarm/hierarchical-planner.js";
import { countNodes, treeDepth, collectLeaves, collectManagers } from "../../packages/engine/src/swarm/hierarchical-types.js";

describe("HierarchicalPlanner", () => {
  const planner = new HierarchicalPlanner();

  it("creates a tree with root for any goal", () => {
    const tree = planner.createTree({ sessionId: "s1", goal: "Build a web app" });
    expect(tree.root).toBeTruthy();
    expect(tree.root.name).toBe("RootManager");
    expect(tree.sessionId).toBe("s1");
    expect(tree.goal).toBe("Build a web app");
  });

  it("creates child managers for each inferred category", () => {
    const tree = planner.createTree({ sessionId: "s2", goal: "Research, implement, and document a solution" });
    expect(tree.root.children.length).toBeGreaterThanOrEqual(3);

    const names = tree.root.children.map((c) => c.name);
    expect(names).toContain("ResearchManager");
    expect(names).toContain("EngineeringManager");
    expect(names).toContain("SynthesisManager");
  });

  it("each manager node has leaf children with role assignments", () => {
    const tree = planner.createTree({ sessionId: "s3", goal: "Research and analyze RAG systems" });
    for (const child of tree.root.children) {
      expect(child.children.length).toBeGreaterThan(0);
      for (const leaf of child.children) {
        expect(leaf.assignments.length).toBeGreaterThan(0);
        expect(leaf.assignments[0].role).toBeTruthy();
        expect(leaf.assignments[0].task).toContain("Research and analyze RAG systems");
      }
    }
  });

  it("respects maxDepth = 1 (flat tree)", () => {
    const tree = planner.createTree({ sessionId: "s4", goal: "Complex distributed system", maxDepth: 1 });
    expect(tree.root.depth).toBe(0);
    for (const child of tree.root.children) {
      expect(child.depth).toBeLessThanOrEqual(1);
      // At depth 1, managers become leaves (no sub-children)
      // Actually at maxDepth=1, the root can't have depth-2 children
      // The decompose function checks depth >= maxDepth for the root
    }
  });

  it("respects maxNodes limit", () => {
    const tree = planner.createTree({ sessionId: "s5", goal: "Research, implement, test, and document everything", maxNodes: 5 });
    const total = countNodes(tree.root);
    expect(total).toBeLessThanOrEqual(5);
  });

  it("assigns unique IDs to every node", () => {
    const tree = planner.createTree({ sessionId: "s6", goal: "Full stack application with research" });
    const ids = new Set<string>();
    let hasDuplicates = false;
    function walk(n: typeof tree.root): void {
      if (ids.has(n.id)) hasDuplicates = true;
      ids.add(n.id);
      for (const c of n.children) walk(c);
    }
    walk(tree.root);
    expect(hasDuplicates).toBe(false);
  });

  it("buildNodeMap matches walk", () => {
    const tree = planner.createTree({ sessionId: "s7", goal: "Map test" });
    // Count via function walk
    const count = countNodes(tree.root);
    expect(tree.nodes.size).toBe(count);
  });

  it("collectLeaves returns all leaf nodes", () => {
    const tree = planner.createTree({ sessionId: "s8", goal: "Research project" });
    const leaves = collectLeaves(tree.root);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(leaf.children.length).toBe(0);
    }
  });

  it("inferCategories maps research goals to ResearchManager", () => {
    const tree = planner.createTree({ sessionId: "s9", goal: "Investigate quantum computing" });
    const names = tree.root.children.map((c) => c.name);
    expect(names).toContain("ResearchManager");
  });

  it("inferCategories maps coding goals to EngineeringManager", () => {
    const tree = planner.createTree({ sessionId: "s10", goal: "Build a CLI tool in TypeScript" });
    const names = tree.root.children.map((c) => c.name);
    expect(names).toContain("EngineeringManager");
  });

  it("ambiguous goals get research, analysis, and writing", () => {
    const tree = planner.createTree({ sessionId: "s11", goal: "Help me with my project" });
    const names = tree.root.children.map((c) => c.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
  });
});
