import * as store from "@arely/persistence";
import type { MemoryRecord, MemoryType } from "./memory-types.js";

export interface MemoryScoredRecord extends MemoryRecord {
  relevanceScore: number;
}

export interface MemoryRetrievalOptions {
  sessionId?: string;
  query: string;
  types?: MemoryType[];
  limit?: number;
  minConfidence?: number;
}

const DAY_MS = 86400000;

export class MemoryRetrievalService {
  async getRelevant(opts: MemoryRetrievalOptions): Promise<MemoryScoredRecord[]> {
    const memories = await store.searchMemories(opts.sessionId ?? null, {
      typeIn: opts.types,
      minConfidence: opts.minConfidence ?? 0.3,
      limit: 100,
    });

    const scored = memories
      .map((m) => ({
        ...m,
        relevanceScore: this.score(m, opts.query),
      }))
      .filter((m) => m.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored.slice(0, opts.limit ?? 10);
  }

  private score(memory: MemoryRecord, query: string): number {
    const text = `${memory.key} ${memory.value}`;
    const semantic = this.simpleSimilarity(text, query);
    const recency = this.recencyBoost(memory.lastAccessedAt);
    const accessBoost = Math.min(memory.accessCount / 10, 1) * 0.1;
    const confidence = memory.confidence / 100;

    return semantic * 0.6 + confidence * 0.25 + accessBoost * 0.1 + recency * 0.05;
  }

  simpleSimilarity(text: string, query: string): number {
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

  recencyBoost(lastAccessedAt: string | null): number {
    if (!lastAccessedAt) return 0;
    const age = Date.now() - new Date(lastAccessedAt).getTime();
    if (age < 0) return 1;
    const days = age / DAY_MS;
    return Math.max(0, 1 - days / 30);
  }
}

export const memoryRetrievalService = new MemoryRetrievalService();
