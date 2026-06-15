import { MemoryService } from "@arely/memory";

export class Memory {
  private service: MemoryService;
  private connected = false;

  constructor() {
    this.service = new MemoryService();
  }

  markConnected(): void {
    this.connected = true;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("Memory is not available. Provide dbPath in config or call connect() first.");
    }
  }

  async set(
    type: string,
    key: string,
    value: string,
    confidence = 100,
    tags: string[] = [],
  ): Promise<void> {
    this.ensureConnected();
    await this.service.setMemory(null, type as any, key, value, confidence, "explicit", tags);
  }

  async get(type: string, key: string): Promise<{ type: string; key: string; value: string; confidence: number } | null> {
    this.ensureConnected();
    const record = await this.service.getMemory(type as any, key);
    if (!record) return null;
    return { type: record.type, key: record.key, value: record.value, confidence: record.confidence };
  }

  async search(type?: string, tags?: string[], limit = 10): Promise<Array<{ type: string; key: string; value: string; confidence: number }>> {
    this.ensureConnected();
    const records = await this.service.searchMemories(null, { ...(type ? { type: type as any } : {}), tags, limit });
    return records.map((r) => ({ type: r.type, key: r.key, value: r.value, confidence: r.confidence }));
  }

  async delete(type: string, key: string): Promise<boolean> {
    this.ensureConnected();
    return this.service.deleteMemory(type as any, key);
  }
}
