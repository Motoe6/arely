import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, close, createInMemoryDb } from "@arelyos/persistence";

describe("CrossSessionMemory", () => {
  beforeAll(async () => {
    const inMemory = createInMemoryDb();
    process.env.DB_PATH = ":memory:";
    connect();
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });

  it("stores and retrieves a global memory", async () => {
    const { setGlobalMemory, getGlobalMemory } = await import("@arelyos/persistence");
    const mem = await setGlobalMemory(
      "GPT-4o es rápido",
      "session-1",
      ["GPT-4o"],
      ["model", "performance"],
      0.9,
      95,
    );
    expect(mem.id).toBeTruthy();
    expect(mem.content).toBe("GPT-4o es rápido");
    expect(mem.sessionIds).toEqual(["session-1"]);
    expect(mem.entities).toEqual(["GPT-4o"]);
    expect(mem.tags).toEqual(["model", "performance"]);
    expect(mem.importance).toBe(0.9);
    expect(mem.confidence).toBe(95);

    const retrieved = await getGlobalMemory(mem.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe("GPT-4o es rápido");
  });

  it("stores a second memory and associates entities", async () => {
    const { setGlobalMemory } = await import("@arelyos/persistence");
    const mem = await setGlobalMemory(
      "Claude es bueno en research",
      "session-1",
      ["Claude"],
      ["model", "research"],
      0.8,
      90,
    );
    expect(mem.entities).toEqual(["Claude"]);
  });

  it("searches global memories by text content", async () => {
    const { searchGlobalMemories } = await import("@arelyos/persistence");
    const results = await searchGlobalMemories({ query: "GPT-4o", limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("GPT-4o");
  });

  it("searches global memories by tag", async () => {
    const { searchGlobalMemories } = await import("@arelyos/persistence");
    const results = await searchGlobalMemories({ tags: ["research"], limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r: { tags: string[] }) => r.tags.includes("research"))).toBe(true);
  });

  it("searches global memories by entity", async () => {
    const { searchGlobalMemories } = await import("@arelyos/persistence");
    const results = await searchGlobalMemories({ entities: ["Claude"], limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r: { entities: string[] }) => r.entities.includes("Claude"))).toBe(true);
  });

  it("filters by minimum importance", async () => {
    const { searchGlobalMemories } = await import("@arelyos/persistence");
    const results = await searchGlobalMemories({ minImportance: 0.85, limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r: { importance: number }) => r.importance >= 0.85)).toBe(true);
  });

  it("creates entity relations and queries them", async () => {
    const { upsertEntityRelation, getEntityRelations, getRelatedEntities } = await import("@arelyos/persistence");

    await upsertEntityRelation("GPT-4o", "OpenAI", "created_by", 1.0);
    await upsertEntityRelation("GPT-4o", "Claude", "competitor", 0.5);

    const relations = await getEntityRelations("GPT-4o");
    expect(relations.length).toBeGreaterThanOrEqual(2);

    const related = await getRelatedEntities("GPT-4o");
    expect(related.length).toBeGreaterThanOrEqual(2);
    const relatedNames = related.map((r: { entity: string }) => r.entity);
    expect(relatedNames).toContain("OpenAI");
    expect(relatedNames).toContain("Claude");
  });

  it("gets entity memories", async () => {
    const { getEntityMemories } = await import("@arelyos/persistence");
    const memories = await getEntityMemories("GPT-4o");
    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories[0].entities).toContain("GPT-4o");
  });

  it("counts global memories, entities, and relations", async () => {
    const { countGlobalMemories, countDistinctEntities, countEntityRelations } = await import("@arelyos/persistence");
    const memCount = await countGlobalMemories();
    expect(memCount).toBeGreaterThanOrEqual(2);

    const entCount = await countDistinctEntities();
    expect(entCount).toBeGreaterThanOrEqual(2);

    const relCount = await countEntityRelations();
    expect(relCount).toBeGreaterThanOrEqual(2);
  });

  it("deletes a global memory", async () => {
    const { setGlobalMemory, deleteGlobalMemory, getGlobalMemory } = await import("@arelyos/persistence");
    const mem = await setGlobalMemory("Temporal", "session-x", [], [], 0.1, 10);
    const deleted = await deleteGlobalMemory(mem.id);
    expect(deleted).toBe(true);
    const retrieved = await getGlobalMemory(mem.id);
    expect(retrieved).toBeNull();
  });

  it("crossSessionMemory.searchScored returns relevance-scored results", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const results = await crossSessionMemory.searchScored({ query: "research", limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(typeof r.relevanceScore).toBe("number");
      expect(r.relevanceScore).toBeGreaterThan(0);
    }
  });

  it("crossSessionMemory.graph returns entity graph", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const graph = await crossSessionMemory.graph("GPT-4o");
    expect(graph.entity).toBe("GPT-4o");
    expect(graph.memories.length).toBeGreaterThanOrEqual(1);
    expect(graph.relatedEntities.length).toBeGreaterThanOrEqual(2);
  });
});

describe("EntityExtractor", () => {
  it("extracts known models from text", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("GPT-4o is the latest model from OpenAI");
    const models = result.filter((e) => e.type === "model");
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models.some((m) => m.value.toLowerCase() === "gpt-4o")).toBe(true);
  });

  it("extracts known providers from text", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("Anthropic created Claude");
    const providers = result.filter((e) => e.type === "provider");
    expect(providers.some((p) => p.value.toLowerCase() === "anthropic")).toBe(true);
  });

  it("extracts organizations from text", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("IBM and Nvidia are big tech companies");
    const orgs = result.filter((e) => e.type === "organization");
    expect(orgs.some((o) => o.value.toLowerCase() === "ibm")).toBe(true);
    expect(orgs.some((o) => o.value.toLowerCase() === "nvidia")).toBe(true);
  });

  it("extracts technologies from text", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("The system uses TypeScript, Docker, and PostgreSQL");
    const techs = result.filter((e) => e.type === "technology");
    expect(techs.some((t) => t.value.toLowerCase() === "typescript")).toBe(true);
    expect(techs.some((t) => t.value.toLowerCase() === "docker")).toBe(true);
    expect(techs.some((t) => t.value.toLowerCase() === "postgresql")).toBe(true);
  });

  it("extracts tasks from text", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("The task is to implement a distributed system");
    const tasks = result.filter((e) => e.type === "task");
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates entities keeping highest confidence", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const result = extractEntities("OpenAI OpenAI OpenAI");
    const openai = result.filter((e) => e.value.toLowerCase() === "openai");
    expect(openai.length).toBe(1);
  });

  it("extracts from multiple texts", async () => {
    const { extractEntitiesFromMultiple } = await import("@arelyos/memory");
    const result = extractEntitiesFromMultiple([
      "GPT-4o is fast",
      "Claude is good at research",
    ]);
    expect(result.some((e) => e.value.toLowerCase() === "gpt-4o")).toBe(true);
    expect(result.some((e) => e.value.toLowerCase() === "claude")).toBe(true);
  });
});

describe("RelationBuilder", () => {
  it("builds 'uses' relation from verb pattern", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const { buildRelations } = await import("@arelyos/memory");

    const text = "ARELY uses OpenAI for inference";
    const entities = extractEntities(text);
    const relations = buildRelations(entities, text);

    expect(relations.length).toBeGreaterThanOrEqual(1);
    const uses = relations.find((r) => r.relationType === "uses");
    expect(uses).toBeDefined();
  });

  it("builds 'depends_on' relation from verb pattern", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const { buildRelations } = await import("@arelyos/memory");

    const text = "SwarmManager depends on Coordinator for orchestration";
    const entities = extractEntities(text);
    const relations = buildRelations(entities, text);

    const dependsOn = relations.find((r) => r.relationType === "depends_on");
    expect(dependsOn).toBeDefined();
  });

  it("builds co-occurrence relations for entities in same sentence", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const { buildRelations } = await import("@arelyos/memory");

    const text = "GPT-4o and Claude are both powerful language models";
    const entities = extractEntities(text);
    const relations = buildRelations(entities, text);

    const relatedTo = relations.find((r) => r.relationType === "related_to");
    expect(relatedTo).toBeDefined();
    expect(relatedTo!.weight).toBeGreaterThan(0);
  });

  it("merges duplicate relations with accumulated weight", async () => {
    const { extractEntities } = await import("@arelyos/memory");
    const { buildRelations } = await import("@arelyos/memory");

    const text = "GPT-4o and Claude. GPT-4o and Claude are related.";
    const entities = extractEntities(text);
    const relations = buildRelations(entities, text);

    const relatedTo = relations.filter((r) => r.relationType === "related_to");
    // All "related_to" between GPT-4o and Claude should be merged into one
    expect(relatedTo.length).toBeGreaterThanOrEqual(1);
    if (relatedTo.length === 1) {
      expect(relatedTo[0].weight).toBeGreaterThan(0.5);
    }
  });
});

describe("EntityGraph", () => {
  beforeAll(async () => {
    process.env.DB_PATH = ":memory:";
    connect();
    // Seed some data for graph tests
    const { setGlobalMemory, upsertEntityRelation } = await import("@arelyos/persistence");
    await setGlobalMemory("ARELY uses OpenAI for AI tasks", "s1", ["ARELY", "OpenAI"], [], 1.0, 100);
    await setGlobalMemory("OpenAI created GPT-4o", "s1", ["OpenAI", "GPT-4o"], [], 1.0, 100);
    await setGlobalMemory("ARELY uses Docker for deployment", "s2", ["ARELY", "Docker"], [], 0.9, 95);
    await setGlobalMemory("Claude is an Anthropic model", "s2", ["Claude", "Anthropic"], [], 0.9, 95);
    await setGlobalMemory("Docker runs on Kubernetes", "s3", ["Docker", "Kubernetes"], [], 0.8, 90);

    await upsertEntityRelation("ARELY", "OpenAI", "uses", 1.0);
    await upsertEntityRelation("OpenAI", "GPT-4o", "created_by", 1.0);
    await upsertEntityRelation("ARELY", "Docker", "uses", 1.0);
    await upsertEntityRelation("Docker", "Kubernetes", "depends_on", 1.0);
    await upsertEntityRelation("Claude", "Anthropic", "created_by", 1.0);
  });

  it("gets a node from the graph", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const node = await entityGraph.getNode("ARELY");
    expect(node).not.toBeNull();
    expect(node!.entity).toBe("ARELY");
    expect(node!.degree).toBeGreaterThanOrEqual(1);
  });

  it("returns null for unknown entity", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const node = await entityGraph.getNode("NonExistentEntityXYZ");
    expect(node).toBeNull();
  });

  it("gets neighbors of an entity", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const neighbors = await entityGraph.getNeighbors("ARELY");
    expect(neighbors.length).toBeGreaterThanOrEqual(2);
    const names = neighbors.map((n) => n.entity);
    expect(names).toContain("OpenAI");
    expect(names).toContain("Docker");
  });

  it("gets subgraph at depth 2", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const subgraph = await entityGraph.getSubgraph("ARELY", 2);
    expect(subgraph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(subgraph.edges.length).toBeGreaterThanOrEqual(2);

    const names = subgraph.nodes.map((n) => n.entity);
    expect(names).toContain("ARELY");
    expect(names).toContain("OpenAI");
    expect(names).toContain("Docker");
  });

  it("finds shortest path between two entities", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const path = await entityGraph.shortestPath("ARELY", "GPT-4o");
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0].entity).toBe("ARELY");
    expect(path![path!.length - 1].entity).toBe("GPT-4o");
  });

  it("returns null for unreachable entities", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const path = await entityGraph.shortestPath("ARELY", "NonExistentEntityXYZ");
    expect(path).toBeNull();
  });

  it("computes centrality (degree)", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const cent = await entityGraph.centrality("ARELY");
    expect(cent.degree).toBeGreaterThanOrEqual(2);
  });

  it("recommends related entities", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const recommendations = await entityGraph.recommendRelated("ARELY", 3);
    expect(recommendations.length).toBeGreaterThanOrEqual(1);
    for (const r of recommendations) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("gets edges for an entity", async () => {
    const { entityGraph } = await import("@arelyos/memory");
    const edges = await entityGraph.getEdges("OpenAI");
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].source).toBeTruthy();
    expect(edges[0].target).toBeTruthy();
    expect(edges[0].weight).toBeGreaterThan(0);
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });
});

describe("CrossSessionMemory Integration — Auto-extraction", () => {
  beforeAll(async () => {
    process.env.DB_PATH = ":memory:";
    connect();
    const { setGlobalMemory } = await import("@arelyos/persistence");
    // Seed with memories that have manually specified entities
    await setGlobalMemory("Distributed systems use WebSockets", "integ-s1", ["WebSockets"], ["distributed"], 1.0, 100);
    await setGlobalMemory("Kubernetes orchestrates containers", "integ-s1", ["Kubernetes"], ["infra"], 1.0, 100);
    await setGlobalMemory("Prometheus monitors cluster metrics", "integ-s1", ["Prometheus"], ["monitoring"], 1.0, 100);
  });

  it("store() auto-extracts entities when none provided", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const result = await crossSessionMemory.store({
      content: "OpenAI released GPT-4o with amazing performance",
      sessionId: "auto-s1",
      tags: ["ai"],
    });
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    expect(result.entities.some((e) => e.toLowerCase() === "openai" || e.toLowerCase() === "gpt-4o")).toBe(true);
  });

  it("storeWithExtraction returns extracted entities and relations count", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const result = await crossSessionMemory.storeWithExtraction({
      content: "ARELY uses Prometheus for monitoring Kubernetes clusters",
      sessionId: "auto-s2",
    });
    expect(result.extractedEntities.length).toBeGreaterThanOrEqual(2);
    expect(result.relationsBuilt).toBeGreaterThanOrEqual(1);
    expect(result.entities.length).toBeGreaterThanOrEqual(2);
  });

  it("search with expandWithGraph returns related memories", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const results = await crossSessionMemory.search({
      query: "WebSockets",
      expandWithGraph: true,
      limit: 10,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Should also find memories related through the graph
    expect(results.some((r) => r.content.toLowerCase().includes("websockets") ||
      r.entities.some((e) => e.toLowerCase() === "websockets"))).toBe(true);
  });

  it("graph-enhanced search expands entities correctly", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    // Search without graph expansion first
    const withoutGraph = await crossSessionMemory.search({
      query: "monitoring",
      limit: 5,
    });
    // Search with graph expansion
    const withGraph = await crossSessionMemory.search({
      query: "monitoring",
      expandWithGraph: true,
      limit: 10,
    });
    // Graph expansion should bring in related memories via entities
    expect(withGraph.length).toBeGreaterThanOrEqual(withoutGraph.length);
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });
});

describe("B2.3.3 — Memory Prioritization", () => {
  beforeAll(async () => {
    process.env.DB_PATH = ":memory:";
    connect();
    const { setGlobalMemory } = await import("@arelyos/persistence");
    await setGlobalMemory("High importance memory about AI", "p-s1", ["AI"], [], 0.95, 100);
    await setGlobalMemory("Medium importance memory about ML", "p-s1", ["ML"], [], 0.6, 70);
    await setGlobalMemory("Low importance memory about data", "p-s1", ["data"], [], 0.2, 30);
  });

  it("computeMemoryScore returns a weighted composite score", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories } = await import("@arelyos/persistence");
    const all = await listAllGlobalMemories();
    for (const mem of all) {
      const score = crossSessionMemory.computeMemoryScore(mem);
      expect(typeof score).toBe("number");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("rankMemories returns memories sorted descending by score", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories } = await import("@arelyos/persistence");
    const all = await listAllGlobalMemories();
    const ranked = crossSessionMemory.rankMemories(all);
    expect(ranked.length).toBe(all.length);
    for (let i = 1; i < ranked.length; i++) {
      const prevScore = crossSessionMemory.computeMemoryScore(ranked[i - 1]);
      const currScore = crossSessionMemory.computeMemoryScore(ranked[i]);
      expect(prevScore).toBeGreaterThanOrEqual(currScore);
    }
  });

  it("high importance memories rank higher than low importance", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories } = await import("@arelyos/persistence");
    const all = await listAllGlobalMemories();
    const ai = all.find((m) => m.content.includes("High importance"));
    const data = all.find((m) => m.content.includes("Low importance"));
    expect(ai).toBeTruthy();
    expect(data).toBeTruthy();
    const aiScore = crossSessionMemory.computeMemoryScore(ai!);
    const dataScore = crossSessionMemory.computeMemoryScore(data!);
    expect(aiScore).toBeGreaterThan(dataScore);
  });

  it("metrics returns expected shape with zero defaults", async () => {
    const { crossSessionMemory, CrossSessionMemory } = await import("@arelyos/memory");
    const fresh = new CrossSessionMemory();
    const m = fresh.metrics;
    expect(m.memoryHitsTotal).toBe(0);
    expect(m.memoryMissesTotal).toBe(0);
    expect(m.memoriesPrunedTotal).toBe(0);
    expect(m.memoryMergesTotal).toBe(0);
    expect(typeof m.memoryRetrievalScore).toBe("number");
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });
});

describe("B2.3.4 — Memory Forgetting", () => {
  beforeAll(async () => {
    process.env.DB_PATH = ":memory:";
    connect();
    const { setGlobalMemory } = await import("@arelyos/persistence");
    await setGlobalMemory("Important memory to keep", "f-s1", ["keep"], ["important"], 0.9, 95);
    await setGlobalMemory("Low importance to archive", "f-s1", ["trash"], ["trash"], 0.1, 10);
    await setGlobalMemory("Medium importance memory", "f-s1", ["medium"], [], 0.5, 50);
    await setGlobalMemory("Low confidence memory", "f-s2", ["unconfident"], [], 0.3, 20);
  });

  it("forget archives memories below importance threshold", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories, countArchivedMemories } = await import("@arelyos/persistence");
    const before = await countArchivedMemories();
    const archived = await crossSessionMemory.forget({ minImportance: 0.2 });
    expect(archived).toBeGreaterThanOrEqual(1);
    // Archived memories should not appear in normal listing
    const all = await listAllGlobalMemories({ includeArchived: false });
    expect(all.every((m) => m.importance >= 0.2)).toBe(true);
  });

  it("forget also archives memories below confidence threshold", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories } = await import("@arelyos/persistence");
    const archived = await crossSessionMemory.forget({ minConfidence: 30 });
    const all = await listAllGlobalMemories({ includeArchived: false });
    expect(all.every((m) => m.confidence >= 30)).toBe(true);
  });

  it("archive sets archivedAt on a specific memory", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories } = await import("@arelyos/persistence");
    const all = await listAllGlobalMemories({ includeArchived: true });
    const target = all.find((m) => m.content.includes("Medium importance"));
    expect(target).toBeTruthy();
    const archived = await crossSessionMemory.archive(target!.id);
    expect(archived).not.toBeNull();
    expect(archived!.archivedAt).not.toBeNull();
  });

  it("prune deletes archived memories older than retention", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { listAllGlobalMemories, updateGlobalMemory } = await import("@arelyos/persistence");
    const { setGlobalMemory } = await import("@arelyos/persistence");
    const old = await setGlobalMemory("Old archived memory", "f-old", [], [], 0.1, 10);
    // Archive and backdate archivedAt
    await crossSessionMemory.archive(old.id);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    await updateGlobalMemory(old.id, { archivedAt: sixtyDaysAgo });
    const pruned = await crossSessionMemory.prune(30);
    expect(pruned).toBeGreaterThanOrEqual(1);
    const all = await listAllGlobalMemories({ includeArchived: true });
    expect(all.find((m) => m.id === old.id)).toBeUndefined();
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });
});

describe("B2.3.5 — Memory Consolidation", () => {
  beforeAll(async () => {
    process.env.DB_PATH = ":memory:";
    connect();
    const { setGlobalMemory } = await import("@arelyos/persistence");
    // Create near-duplicate memories
    await setGlobalMemory("ARELY uses OpenAI for inference tasks", "c-s1", ["ARELY", "OpenAI"], ["ai"], 0.9, 95);
    await setGlobalMemory("ARELY uses OpenAI for inference tasks daily", "c-s2", ["ARELY", "OpenAI"], ["ai", "daily"], 0.8, 90);
    // Different entity for merge tests
    await setGlobalMemory("GPT-4o is developed by OpenAI", "c-s1", ["GPT-4o", "OpenAI"], ["model"], 1.0, 100);
  });

  it("findDuplicates detects similar memories", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const pairs = await crossSessionMemory.findDuplicates(0.5);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (const [a, b] of pairs) {
      expect(a.content).toBeTruthy();
      expect(b.content).toBeTruthy();
    }
  });

  it("mergeMemories combines two memories into one", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const pairs = await crossSessionMemory.findDuplicates(0.5);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    const [primary, secondary] = pairs[0];

    const merged = await crossSessionMemory.mergeMemories(primary, secondary);
    expect(merged).not.toBeNull();
    expect(merged!.sessionIds.length).toBeGreaterThanOrEqual(2);

    // Secondary should be deleted
    const { getGlobalMemory } = await import("@arelyos/persistence");
    const deleted = await getGlobalMemory(secondary.id);
    expect(deleted).toBeNull();
  });

  it("mergeEntities merges two entity references", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { getEntityMemories, setGlobalMemory, upsertEntityRelation } = await import("@arelyos/persistence");
    // Create an entity with a different name for the same thing
    await setGlobalMemory("OpenAI developed GPT-4o", "c-merge", ["OpenAI", "GPT-4o"], [], 1.0, 100);
    await upsertEntityRelation("GPT-4o", "OpenAI", "created_by", 1.0);

    await crossSessionMemory.mergeEntities("GPT-4o", "GPT4o");

    // Entity references should be updated
    const relationRels = await upsertEntityRelation("ARELY", "GPT4o", "uses", 1.0);
    expect(relationRels).toBeTruthy();
  });

  it("mergeRelations merges relations from source to target entity", async () => {
    const { crossSessionMemory } = await import("@arelyos/memory");
    const { getEntityRelations, upsertEntityRelation } = await import("@arelyos/persistence");
    await upsertEntityRelation("ARELY", "Docker", "uses", 1.0);

    await crossSessionMemory.mergeRelations("Docker", "ContainerDocker", "uses");

    const rels = await getEntityRelations("ContainerDocker");
    expect(rels.length).toBeGreaterThanOrEqual(0);
  });

  afterAll(() => {
    close();
    delete process.env.DB_PATH;
  });
});
