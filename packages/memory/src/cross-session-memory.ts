import * as store from "@arelyos/persistence";
import type { GlobalMemoryRecord, GlobalMemorySearchQuery } from "./cross-session-memory-types.js";
import { extractEntities, extractEntitiesFromMultiple } from "./entity-extractor.js";
import { buildRelations } from "./relation-builder.js";
import { entityGraph } from "./entity-graph.js";

export interface StoreGlobalMemoryInput {
  content: string;
  sessionId: string;
  entities?: string[];
  tags?: string[];
  importance?: number;
  confidence?: number;
  skipAutoExtract?: boolean;
}

export interface SearchGlobalMemoryOptions {
  query?: string;
  tags?: string[];
  entities?: string[];
  minImportance?: number;
  minConfidence?: number;
  limit?: number;
  expandWithGraph?: boolean;
}

export interface GraphResult {
  entity: string;
  memories: GlobalMemoryRecord[];
  relatedEntities: Array<{ entity: string; weight: number; relationType: string }>;
}

export interface MemoryMetrics {
  memoryRetrievalScore: number;
  memoryHitsTotal: number;
  memoryMissesTotal: number;
  memoriesPrunedTotal: number;
  memoryDecayScore: number;
  memoryArchiveSize: number;
  memoryMergesTotal: number;
  duplicateMemoriesTotal: number;
  entityMergeCount: number;
}

const DAY_MS = 86400000;
const DECAY_LAMBDA = 0.01;

function simpleSimilarity(text: string, query: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

  const textTokens = new Set(normalize(text));
  const queryTokens = normalize(query);

  if (queryTokens.length === 0 || textTokens.size === 0) return 0;

  let matchCount = 0;
  for (const qt of queryTokens) {
    if (textTokens.has(qt)) matchCount++;
    else {
      for (const tt of textTokens) {
        if (tt.includes(qt) || qt.includes(tt)) {
          matchCount += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(matchCount / queryTokens.length, 1);
}

function recencyBoost(lastAccessedAt: string | null): number {
  if (!lastAccessedAt) return 0;
  const age = Date.now() - new Date(lastAccessedAt).getTime();
  if (age < 0) return 1;
  const days = age / DAY_MS;
  return Math.max(0, 1 - days / 30);
}

function textSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const tA = tokenize(a);
  const tB = tokenize(b);
  if (tA.size === 0 || tB.size === 0) return 0;
  let intersection = 0;
  for (const tok of tA) {
    if (tB.has(tok)) intersection++;
  }
  const union = tA.size + tB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class CrossSessionMemory {
  private _hits = 0;
  private _misses = 0;
  private _pruned = 0;
  private _merges = 0;

  // ─── B2.3.3: Prioritization ───

  computeMemoryScore(memory: GlobalMemoryRecord): number {
    const imp = memory.importance * 0.40;
    const conf = (memory.confidence / 100) * 0.20;
    const recency = recencyBoost(memory.lastAccessedAt) * 0.20;
    const accessFreq = Math.min(memory.accessCount / 20, 1) * 0.20;
    return imp + conf + recency + accessFreq;
  }

  rankMemories(memories: GlobalMemoryRecord[]): GlobalMemoryRecord[] {
    return [...memories].sort((a, b) => this.computeMemoryScore(b) - this.computeMemoryScore(a));
  }

  get metrics(): MemoryMetrics {
    return {
      memoryRetrievalScore: this._hits + this._misses > 0
        ? this._hits / (this._hits + this._misses)
        : 0,
      memoryHitsTotal: this._hits,
      memoryMissesTotal: this._misses,
      memoriesPrunedTotal: this._pruned,
      memoryDecayScore: 0,
      memoryArchiveSize: 0,
      memoryMergesTotal: this._merges,
      duplicateMemoriesTotal: 0,
      entityMergeCount: 0,
    };
  }

  // ─── B2.3.4: Forgetting ───

  private decayAge(memory: GlobalMemoryRecord): number {
    const created = new Date(memory.createdAt).getTime();
    const ageMs = Date.now() - created;
    const ageDays = Math.max(0, ageMs / DAY_MS);
    return Math.exp(-DECAY_LAMBDA * ageDays);
  }

  async forget(
    policies: {
      minImportance?: number;
      minConfidence?: number;
      maxAgeDays?: number;
    } = {},
  ): Promise<number> {
    const all = await store.listAllGlobalMemories({ includeArchived: false });
    const minImp = policies.minImportance ?? 0.15;
    const minConf = policies.minConfidence ?? 0.25;
    const maxAge = policies.maxAgeDays ?? 180;

    let archivedCount = 0;
    for (const mem of all) {
      const accessAge = mem.lastAccessedAt
        ? (Date.now() - new Date(mem.lastAccessedAt).getTime()) / DAY_MS
        : Infinity;
      const shouldArchive =
        mem.importance < minImp ||
        mem.confidence < minConf ||
        accessAge > maxAge;

      if (shouldArchive) {
        await store.updateGlobalMemory(mem.id, { archivedAt: new Date().toISOString() });
        archivedCount++;
      }
    }

    this._pruned += archivedCount;
    return archivedCount;
  }

  async archive(memoryId: string): Promise<GlobalMemoryRecord | null> {
    return store.updateGlobalMemory(memoryId, { archivedAt: new Date().toISOString() });
  }

  async prune(retentionDays: number = 30): Promise<number> {
    const all = await store.listAllGlobalMemories({ includeArchived: true });
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const toDelete: string[] = [];

    for (const mem of all) {
      if (!mem.archivedAt) continue;
      const archivedTime = new Date(mem.archivedAt).getTime();
      if (archivedTime < cutoff) {
        toDelete.push(mem.id);
      }
    }

    if (toDelete.length > 0) {
      await store.deleteGlobalMemories(toDelete);
    }

    this._pruned += toDelete.length;
    return toDelete.length;
  }

  // ─── B2.3.5: Consolidation ───

  async findDuplicates(similarityThreshold: number = 0.7): Promise<Array<[GlobalMemoryRecord, GlobalMemoryRecord]>> {
    const all = await store.listAllGlobalMemories({ includeArchived: false });
    const pairs: Array<[GlobalMemoryRecord, GlobalMemoryRecord]> = [];

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const sim = textSimilarity(all[i].content, all[j].content);
        if (sim >= similarityThreshold) {
          pairs.push([all[i], all[j]]);
        }
      }
    }

    return pairs;
  }

  async mergeMemories(
    primary: GlobalMemoryRecord,
    secondary: GlobalMemoryRecord,
  ): Promise<GlobalMemoryRecord | null> {
    const mergedSessionIds = [...new Set([...primary.sessionIds, ...secondary.sessionIds])];
    const mergedEntities = [...new Set([...primary.entities, ...secondary.entities])];
    const mergedTags = [...new Set([...primary.tags, ...secondary.tags])];
    const mergedContent = primary.content.length >= secondary.content.length
      ? primary.content
      : secondary.content;
    const mergedImportance = Math.max(primary.importance, secondary.importance);
    const mergedConfidence = Math.max(primary.confidence, secondary.confidence);
    const mergedAccessCount = primary.accessCount + secondary.accessCount;

    const result = await store.updateGlobalMemory(primary.id, {
      content: mergedContent,
      sessionIds: mergedSessionIds,
      entities: mergedEntities,
      tags: mergedTags,
      importance: mergedImportance,
      confidence: mergedConfidence,
    });

    await store.deleteGlobalMemory(secondary.id);
    this._merges++;

    return result;
  }

  async mergeEntities(
    sourceEntity: string,
    targetEntity: string,
  ): Promise<void> {
    const sourceMemories = await store.getEntityMemories(sourceEntity);
    for (const mem of sourceMemories) {
      const updatedEntities = mem.entities.map((e: string) =>
        e.toLowerCase() === sourceEntity.toLowerCase() ? targetEntity : e,
      );
      await store.updateGlobalMemory(mem.id, {
        entities: [...new Set(updatedEntities)],
      });
    }

    const sourceRels = await store.getEntityRelations(sourceEntity);
    for (const rel of sourceRels) {
      if (rel.sourceEntity.toLowerCase() === sourceEntity.toLowerCase()) {
        await store.upsertEntityRelation(targetEntity, rel.targetEntity, rel.relationType, rel.weight);
      }
      if (rel.targetEntity.toLowerCase() === sourceEntity.toLowerCase()) {
        await store.upsertEntityRelation(rel.sourceEntity, targetEntity, rel.relationType, rel.weight);
      }
    }
  }

  async mergeRelations(
    sourceEntity: string,
    targetEntity: string,
    relationType: string,
  ): Promise<void> {
    const sourceRels = await store.getEntityRelations(sourceEntity);
    for (const rel of sourceRels) {
      if (rel.relationType !== relationType) continue;
      const otherEntity = rel.sourceEntity === sourceEntity ? rel.targetEntity : rel.sourceEntity;
      await store.upsertEntityRelation(targetEntity, otherEntity, relationType, rel.weight);
    }
  }

  // ─── Original methods (unchanged) ───

  async store(input: StoreGlobalMemoryInput): Promise<GlobalMemoryRecord> {
    let entities = input.entities ?? [];

    if (!input.skipAutoExtract && entities.length === 0) {
      const extracted = extractEntities(input.content);
      entities = extracted.map((e) => e.value);
    }

    const result = await store.setGlobalMemory(
      input.content,
      input.sessionId,
      entities,
      input.tags ?? [],
      input.importance ?? 1.0,
      input.confidence ?? 100,
    );

    if (entities.length > 1) {
      const extracted = extractEntities(input.content);
      const relations = buildRelations(extracted, input.content);

      for (const rel of relations) {
        await store.upsertEntityRelation(
          rel.sourceEntity,
          rel.targetEntity,
          rel.relationType,
          rel.weight,
        );
      }
    }

    return result;
  }

  async storeWithExtraction(input: StoreGlobalMemoryInput): Promise<GlobalMemoryRecord & { extractedEntities: string[]; relationsBuilt: number }> {
    const extracted = extractEntities(input.content);
    const allEntities = [...new Set([...(input.entities ?? []), ...extracted.map((e) => e.value)])];

    const result = await this.store({
      ...input,
      entities: allEntities,
      skipAutoExtract: true,
    });

    const relations = buildRelations(extracted, input.content);
    for (const rel of relations) {
      await store.upsertEntityRelation(
        rel.sourceEntity,
        rel.targetEntity,
        rel.relationType,
        rel.weight,
      );
    }

    return {
      ...result,
      extractedEntities: allEntities,
      relationsBuilt: relations.length,
    };
  }

  async search(opts: SearchGlobalMemoryOptions): Promise<GlobalMemoryRecord[]> {
    let searchEntities = opts.entities;

    if (opts.expandWithGraph && opts.query) {
      const queryEntities = extractEntities(opts.query);
      const expandedEntities = new Set(searchEntities ?? []);

      for (const qe of queryEntities) {
        expandedEntities.add(qe.value);
        const recommendations = await entityGraph.recommendRelated(qe.value, 3);
        for (const rec of recommendations) {
          expandedEntities.add(rec.entity);
        }
      }

      searchEntities = Array.from(expandedEntities);
    }

    const searchQuery: GlobalMemorySearchQuery = {
      query: opts.query,
      tags: opts.tags,
      entities: searchEntities,
      minImportance: opts.minImportance,
      minConfidence: opts.minConfidence,
      limit: opts.limit ?? 10,
    };

    const results = await store.searchGlobalMemories(searchQuery);
    this._hits += results.length;
    this._misses += (opts.limit ?? 10) - results.length > 0 ? (opts.limit ?? 10) - results.length : 0;
    return results;
  }

  async searchScored(opts: SearchGlobalMemoryOptions): Promise<Array<GlobalMemoryRecord & { relevanceScore: number }>> {
    const results = await this.search({ ...opts, limit: 100 });

    const scored = results
      .map((m) => ({
        ...m,
        relevanceScore: this.score(m, opts.query ?? ""),
      }))
      .filter((m) => opts.query ? m.relevanceScore > 0 : true)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored.slice(0, opts.limit ?? 10);
  }

  async graph(entity: string): Promise<GraphResult> {
    const [memories, relatedEntities] = await Promise.all([
      store.getEntityMemories(entity),
      store.getRelatedEntities(entity),
    ]);

    return { entity, memories, relatedEntities };
  }

  async get(id: string): Promise<GlobalMemoryRecord | null> {
    const mem = await store.getGlobalMemory(id);
    if (mem) this._hits++;
    else this._misses++;
    return mem;
  }

  async delete(id: string): Promise<boolean> {
    return store.deleteGlobalMemory(id);
  }

  async count(): Promise<number> {
    return store.countGlobalMemories();
  }

  private score(memory: GlobalMemoryRecord, query: string): number {
    const semantic = simpleSimilarity(memory.content, query);
    const recency = recencyBoost(memory.lastAccessedAt);
    const accessBoost = Math.min(memory.accessCount / 10, 1) * 0.1;
    const confidence = memory.confidence / 100;
    const importance = memory.importance;

    return semantic * 0.5 + confidence * 0.2 + importance * 0.15 + accessBoost * 0.1 + recency * 0.05;
  }
}

export const crossSessionMemory = new CrossSessionMemory();
