import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystemPolicyPackStore, type PolicyPack } from "@arely/engine/agents/policy/policy-pack.js";
import type { PolicyRule } from "@arely/engine/agents/policy/policy-types.js";

function makeRule(id: string): PolicyRule {
  return {
    id,
    when: {},
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000,
    maxExecutionsPerHour: 10,
  };
}

describe("FileSystemPolicyPackStore", () => {
  let tmpDir: string;
  let store: FileSystemPolicyPackStore;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `policy-packs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    store = new FileSystemPolicyPackStore(tmpDir);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should list packs when none exist", () => {
    const packs = store.list();
    expect(packs).toEqual([]);
  });

  it("should create a pack and return it with id and timestamps", () => {
    const pack = store.create({
      name: "test-pack",
      description: "A test pack",
      rules: [makeRule("r1")],
    });
    expect(pack.id).toBeTruthy();
    expect(pack.name).toBe("test-pack");
    expect(pack.description).toBe("A test pack");
    expect(pack.rules).toHaveLength(1);
    expect(pack.createdAt).toBeTruthy();
    expect(pack.updatedAt).toBe(pack.createdAt);
  });

  it("should get a pack by id", () => {
    const created = store.create({ name: "get-test", description: "", rules: [makeRule("r1")] });
    const retrieved = store.get(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe("get-test");
  });

  it("should return undefined for non-existent pack", () => {
    const pack = store.get("nonexistent");
    expect(pack).toBeUndefined();
  });

  it("should update a pack", () => {
    const created = store.create({ name: "update-test", description: "old desc", rules: [makeRule("r1")] });
    const updated = store.update(created.id, { description: "new desc", rules: [makeRule("r1"), makeRule("r2")] });
    expect(updated).toBeDefined();
    expect(updated!.description).toBe("new desc");
    expect(updated!.rules).toHaveLength(2);
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.updatedAt).not.toBe(created.updatedAt);
  });

  it("should return undefined when updating non-existent pack", () => {
    const result = store.update("nonexistent", { name: "new" });
    expect(result).toBeUndefined();
  });

  it("should delete a pack", () => {
    const created = store.create({ name: "delete-test", description: "", rules: [makeRule("r1")] });
    const deleted = store.delete(created.id);
    expect(deleted).toBe(true);
    expect(store.get(created.id)).toBeUndefined();
  });

  it("should return false when deleting non-existent pack", () => {
    const result = store.delete("nonexistent");
    expect(result).toBe(false);
  });

  it("should persist packs to disk", () => {
    const pack = store.create({ name: "persist-test", description: "", rules: [makeRule("r1")] });
    const raw = readFileSync(join(tmpDir, `${pack.id}.json`), "utf-8");
    const parsed = JSON.parse(raw) as PolicyPack;
    expect(parsed.id).toBe(pack.id);
    expect(parsed.name).toBe("persist-test");
  });

  it("should list multiple packs", () => {
    store.create({ name: "pack-a", description: "", rules: [makeRule("r1")] });
    store.create({ name: "pack-b", description: "", rules: [makeRule("r2")] });
    const packs = store.list();
    expect(packs).toHaveLength(2);
  });

  it("should generate a unique id per pack", () => {
    const packA = store.create({ name: "same-name", description: "", rules: [makeRule("r1")] });
    const packB = store.create({ name: "same-name", description: "", rules: [makeRule("r2")] });
    expect(packA.id).not.toBe(packB.id);
  });
});
