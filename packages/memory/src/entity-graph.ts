import * as store from "@arelyos/persistence";
import type { GlobalMemoryRecord } from "./cross-session-memory-types.js";

export interface GraphNode {
  entity: string;
  type: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export class EntityGraph {
  async getNode(entity: string): Promise<GraphNode | null> {
    const memories = await store.getEntityMemories(entity);
    if (memories.length === 0) return null;

    const relations = await store.getEntityRelations(entity);
    return {
      entity,
      type: "concept",
      degree: relations.length,
    };
  }

  async getNeighbors(entity: string): Promise<GraphNode[]> {
    const related = await store.getRelatedEntities(entity);
    const nodes: GraphNode[] = [];

    for (const r of related) {
      const relations = await store.getEntityRelations(r.entity);
      nodes.push({
        entity: r.entity,
        type: "concept",
        degree: relations.length,
      });
    }

    return nodes;
  }

  async getEdges(entity: string): Promise<GraphEdge[]> {
    const relations = await store.getEntityRelations(entity);
    return relations.map((r) => ({
      source: r.sourceEntity,
      target: r.targetEntity,
      relation: r.relationType,
      weight: r.weight,
    }));
  }

  async getSubgraph(entity: string, depth: number = 2): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const edgesSet = new Map<string, GraphEdge>();

    let currentLevel = [entity];
    visited.add(entity.toLowerCase());

    const nodeInfo = await this.getNode(entity);
    if (nodeInfo) nodes.push(nodeInfo);

    for (let d = 0; d < depth && currentLevel.length > 0; d++) {
      const nextLevel: string[] = [];

      for (const current of currentLevel) {
        const related = await store.getRelatedEntities(current);
        const allRels = await store.getEntityRelations(current);

        for (const rel of allRels) {
          const edgeKey = `${rel.sourceEntity}|${rel.targetEntity}|${rel.relationType}`;
          if (!edgesSet.has(edgeKey)) {
            edgesSet.set(edgeKey, {
              source: rel.sourceEntity,
              target: rel.targetEntity,
              relation: rel.relationType,
              weight: rel.weight,
            });
          }
        }

        for (const r of related) {
          const lower = r.entity.toLowerCase();
          if (!visited.has(lower)) {
            visited.add(lower);
            nextLevel.push(r.entity);
            const relCount = (await store.getEntityRelations(r.entity)).length;
            nodes.push({
              entity: r.entity,
              type: "concept",
              degree: relCount,
            });
          }
        }
      }

      currentLevel = nextLevel;
    }

    return { nodes, edges: Array.from(edgesSet.values()) };
  }

  async shortestPath(a: string, b: string): Promise<GraphNode[] | null> {
    if (a.toLowerCase() === b.toLowerCase()) {
      const node = await this.getNode(a);
      return node ? [node] : null;
    }

    const visited = new Set<string>();
    const parent = new Map<string, string | null>();
    const queue: string[] = [a];
    visited.add(a.toLowerCase());

    while (queue.length > 0) {
      const current = queue.shift()!;
      const related = await store.getRelatedEntities(current);

      for (const r of related) {
        const lower = r.entity.toLowerCase();
        if (!visited.has(lower)) {
          visited.add(lower);
          parent.set(r.entity, current);
          queue.push(r.entity);

          if (lower === b.toLowerCase()) {
            const path: string[] = [];
            let step: string | null | undefined = b;
            while (step !== null && step !== undefined) {
              path.unshift(step);
              step = parent.get(step);
            }
            const nodes: GraphNode[] = [];
            for (const e of path) {
              const node = await this.getNode(e);
              if (node) nodes.push(node);
            }
            return nodes;
          }
        }
      }
    }

    return null;
  }

  async centrality(entity: string): Promise<{ degree: number; betweenness: number }> {
    const neighbors = await store.getRelatedEntities(entity);
    return {
      degree: neighbors.length,
      betweenness: 0,
    };
  }

  async recommendRelated(entity: string, limit: number = 5): Promise<Array<{ entity: string; score: number }>> {
    const visited = new Set<string>();
    visited.add(entity.toLowerCase());

    const scoreMap = new Map<string, number>();

    const directRelations = await store.getEntityRelations(entity);
    for (const rel of directRelations) {
      const connected = rel.sourceEntity === entity ? rel.targetEntity : rel.sourceEntity;
      visited.add(connected.toLowerCase());
    }

    for (const rel of directRelations) {
      const connected = rel.sourceEntity === entity ? rel.targetEntity : rel.sourceEntity;
      const secondLevel = await store.getRelatedEntities(connected);

      for (const sl of secondLevel) {
        const lower = sl.entity.toLowerCase();
        if (visited.has(lower)) {
          scoreMap.set(sl.entity, (scoreMap.get(sl.entity) ?? 0) + sl.weight * 0.3);
        }
      }
    }

    // Score based on co-occurrence in same memories
    const memories = await store.getEntityMemories(entity);
    const entitySet = new Set<string>();
    for (const mem of memories) {
      for (const e of mem.entities) {
        const lower = e.toLowerCase();
        if (lower !== entity.toLowerCase() && !visited.has(lower)) {
          entitySet.add(e);
          scoreMap.set(e, (scoreMap.get(e) ?? 0) + 0.5);
        }
      }
    }

    return Array.from(scoreMap.entries())
      .map(([e, s]) => ({ entity: e, score: s }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const entityGraph = new EntityGraph();
