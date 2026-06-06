import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PolicyRule } from "./policy-types.js";

export interface PolicyPack {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyPackStore {
  list(): PolicyPack[];
  get(packId: string): PolicyPack | undefined;
  create(pack: Omit<PolicyPack, "id" | "createdAt" | "updatedAt">): PolicyPack;
  update(packId: string, updates: Partial<Omit<PolicyPack, "id" | "createdAt" | "updatedAt">>): PolicyPack | undefined;
  delete(packId: string): boolean;
}

export class FileSystemPolicyPackStore implements PolicyPackStore {
  private dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  list(): PolicyPack[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readFile(join(this.dir, f)))
      .filter((p): p is PolicyPack => p !== undefined);
  }

  get(packId: string): PolicyPack | undefined {
    const path = this.filePath(packId);
    if (!existsSync(path)) return undefined;
    return this.readFile(path);
  }

  create(pack: Omit<PolicyPack, "id" | "createdAt" | "updatedAt">): PolicyPack {
    const id = pack.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const full: PolicyPack = { id, ...pack, createdAt: now, updatedAt: now };
    this.writeFile(this.filePath(id), full);
    return full;
  }

  update(packId: string, updates: Partial<Omit<PolicyPack, "id" | "createdAt" | "updatedAt">>): PolicyPack | undefined {
    const existing = this.get(packId);
    if (!existing) return undefined;
    const updated: PolicyPack = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.writeFile(this.filePath(packId), updated);
    return updated;
  }

  delete(packId: string): boolean {
    const path = this.filePath(packId);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  private filePath(packId: string): string {
    const safeName = packId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safeName}.json`);
  }

  private readFile(path: string): PolicyPack | undefined {
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as PolicyPack;
    } catch {
      return undefined;
    }
  }

  private writeFile(path: string, pack: PolicyPack): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(pack, null, 2), "utf-8");
  }
}
