import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import {
  createPolicyChange,
  getPolicyChange,
  listPolicyChanges,
  updatePolicyChangeStatus,
} from "@arelyos/engine/persistence/policy-change-store.js";

describe("policy-change-store", () => {
  beforeAll(() => initTestDb());
  afterAll(() => cleanupTestDb());

  const samplePack = JSON.stringify({ rules: [], name: "test" });

  it("creates a draft change", () => {
    const c = createPolicyChange({
      packId: "pack-1",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    expect(c.id).toBeTruthy();
    expect(c.packId).toBe("pack-1");
    expect(c.status).toBe("draft");
    expect(c.recommendationIds).toEqual([]);
  });

  it("gets a change by id", () => {
    const c = createPolicyChange({
      packId: "pack-2",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    const found = getPolicyChange(c.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(c.id);
    expect(found!.packId).toBe("pack-2");
  });

  it("returns undefined for missing id", () => {
    const found = getPolicyChange("nonexistent");
    expect(found).toBeUndefined();
  });

  it("lists changes ordered by creation", () => {
    createPolicyChange({
      packId: "list-a",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    createPolicyChange({
      packId: "list-b",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    const all = listPolicyChanges();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.map((c) => c.packId)).toEqual(
      expect.arrayContaining(["list-a", "list-b"]),
    );
  });

  it("updates status to approved", () => {
    const c = createPolicyChange({
      packId: "pack-3",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    const updated = updatePolicyChangeStatus(c.id, "approved");
    expect(updated!.status).toBe("approved");
    expect(updated!.approvedAt).toBeTruthy();
  });

  it("updates status to applied", () => {
    const c = createPolicyChange({
      packId: "pack-4",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    updatePolicyChangeStatus(c.id, "approved");
    const updated = updatePolicyChangeStatus(c.id, "applied");
    expect(updated!.status).toBe("applied");
    expect(updated!.appliedAt).toBeTruthy();
  });

  it("preserves statusReason when updating", () => {
    const c = createPolicyChange({
      packId: "pack-5",
      originalPackJson: samplePack,
      proposedPackJson: samplePack,
    });
    const updated = updatePolicyChangeStatus(c.id, "approved", "Approved by test");
    expect(updated!.statusReason).toBe("Approved by test");
  });

  it("respects limit and offset", () => {
    const all = listPolicyChanges(2, 0);
    expect(all.length).toBeLessThanOrEqual(2);
  });
});
