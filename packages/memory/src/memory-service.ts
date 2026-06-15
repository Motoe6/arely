import { ulid } from "ulid";
import type { MemoryRecord, MemoryType, MemorySearchQuery, MemorySource } from "./memory-types.js";
import * as store from "@arelyos/persistence";

export class MemoryService {
  async setMemory(
    sessionId: string | null,
    type: MemoryType,
    key: string,
    value: string,
    confidence: number = 100,
    source: MemorySource = "explicit",
    tags: string[] = [],
    epochId: string | null = null,
    ttlSeconds: number | null = null,
  ): Promise<MemoryRecord> {
    const id = ulid();
    return store.setMemory(id, sessionId, type, key, value, confidence, source, tags, epochId, ttlSeconds);
  }

  async getMemory(type: MemoryType, key: string): Promise<MemoryRecord | null> {
    return store.getMemory(type, key);
  }

  async searchMemories(
    sessionId: string | null,
    query: MemorySearchQuery,
  ): Promise<MemoryRecord[]> {
    return store.searchMemories(sessionId, query);
  }

  async listBySession(sessionId: string): Promise<MemoryRecord[]> {
    return store.listBySession(sessionId);
  }

  async deleteMemory(type: MemoryType, key: string): Promise<boolean> {
    return store.deleteMemory(type, key);
  }

  async evictExpired(): Promise<number> {
    return store.evictExpired();
  }

  async evictByCount(maxMemories: number = 5000): Promise<number> {
    return store.evictByCount(maxMemories);
  }

  async summarizeAndStore(
    sessionId: string | null,
    type: MemoryType,
    key: string,
    summary: string,
    source: MemorySource = "derived",
    tags: string[] = [],
    epochId: string | null = null,
  ): Promise<MemoryRecord> {
    return this.setMemory(sessionId, type, key, summary, 100, source, tags, epochId);
  }
}

export const memoryService = new MemoryService();
