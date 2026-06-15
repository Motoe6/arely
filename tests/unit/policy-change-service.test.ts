import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { FileSystemPolicyPackStore } from "@arely/engine/agents/policy/policy-pack.js";
import { PolicyChangeService, ChangeServiceError } from "@arely/engine/control/policy-change-service.js";
import type { PolicyRule } from "@arely/engine/agents/policy/policy-types.js";

describe("PolicyChangeService", () => {
  let packDir: string;
  let packStore: FileSystemPolicyPackStore;
  let service: PolicyChangeService;
  const sampleRule: PolicyRule = {
    id: "rule-1",
    name: "Test Rule",
    description: "A test rule",
    metric: "latency",
    operator: "gt" as const,
    threshold: 100,
    severity: "high" as const,
    action: "log" as const,
    enabled: true,
  };

  beforeAll(() => {
    initTestDb();
    packDir = join(tmpdir(), `f36-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(packDir, { recursive: true });
    const pack = {
      id: "test-pack",
      name: "Test Pack",
      description: "Original description",
      rules: [sampleRule],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(packDir, "test-pack.json"), JSON.stringify(pack));
    packStore = new FileSystemPolicyPackStore(packDir);
    service = new PolicyChangeService(packStore);
  });

  afterAll(() => {
    cleanupTestDb();
    rmSync(packDir, { recursive: true, force: true });
  });

  describe("createChange", () => {
    it("creates a change with original and proposed snapshots", () => {
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [],
        recommendationIds: ["rec-1"],
      });
      expect(change.packId).toBe("test-pack");
      expect(change.status).toBe("draft");
      expect(change.recommendationIds).toEqual(["rec-1"]);

      const original = JSON.parse(change.originalPackJson);
      expect(original.rules).toHaveLength(1);
      const proposed = JSON.parse(change.proposedPackJson);
      expect(proposed.rules).toHaveLength(0);
    });

    it("throws if pack does not exist", () => {
      expect(() =>
        service.createChange({ packId: "nonexistent", proposedRules: [] }),
      ).toThrow(ChangeServiceError);
    });
  });

  describe("approveChange", () => {
    it("approves a draft change", () => {
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [sampleRule],
      });
      const approved = service.approveChange(change.id);
      expect(approved.status).toBe("approved");
      expect(approved.approvedAt).toBeTruthy();
    });

    it("throws if change not found", () => {
      expect(() => service.approveChange("nonexistent")).toThrow(ChangeServiceError);
    });

    it("throws if change is already applied", () => {
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [sampleRule],
      });
      service.approveChange(change.id);
      service.applyChange(change.id);
      expect(() => service.approveChange(change.id)).toThrow(ChangeServiceError);
    });
  });

  describe("applyChange", () => {
    it("applies an approved change and updates the pack", () => {
      const newRule2: PolicyRule = {
        id: "rule-2",
        name: "New Rule",
        description: "Added via change",
        metric: "error_rate",
        operator: "gt" as const,
        threshold: 5,
        severity: "critical" as const,
        action: "block" as const,
        enabled: true,
      };
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [sampleRule, newRule2],
      });
      service.approveChange(change.id);
      const applied = service.applyChange(change.id);
      expect(applied.status).toBe("applied");
      expect(applied.appliedAt).toBeTruthy();

      const updatedPack = packStore.get("test-pack");
      expect(updatedPack).toBeDefined();
      expect(updatedPack!.rules).toHaveLength(2);
    });

    it("is idempotent when already applied", () => {
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [sampleRule],
      });
      service.approveChange(change.id);
      service.applyChange(change.id);
      const result = service.applyChange(change.id);
      expect(result.status).toBe("applied");
    });

  });

  describe("getChange / listChanges", () => {
    it("gets a change by id", () => {
      const change = service.createChange({
        packId: "test-pack",
        proposedRules: [sampleRule],
      });
      const found = service.getChange(change.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(change.id);
    });

    it("lists changes", () => {
      const changes = service.listChanges();
      expect(changes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("applyChange — edge cases", () => {
    it("recreates pack for destructive tests", () => {
      const pack = {
        id: "edge-pack",
        name: "Edge Pack",
        description: "For edge case tests",
        rules: [sampleRule],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(join(packDir, "edge-pack.json"), JSON.stringify(pack));
    });

    it("throws if change is not approved", () => {
      const change = service.createChange({
        packId: "edge-pack",
        proposedRules: [sampleRule],
      });
      expect(() => service.applyChange(change.id)).toThrow(ChangeServiceError);
    });

    it("throws if pack was removed", () => {
      const change = service.createChange({
        packId: "edge-pack",
        proposedRules: [sampleRule],
      });
      service.approveChange(change.id);
      packStore.delete("edge-pack");
      expect(() => service.applyChange(change.id)).toThrow(ChangeServiceError);
    });
  });
});
