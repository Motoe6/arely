import { assertValidTransition } from "../types/policy-change.js";
import type { PolicyChange, PolicyChangeStatus } from "../types/policy-change.js";
import type { PolicyPackStore } from "../agents/policy/policy-pack.js";
import type { PolicyPack } from "../agents/policy/policy-pack.js";
import type { PolicyRecommendation } from "../agents/policy/policy-recommender.js";
import {
  createPolicyChange as dbCreate,
  getPolicyChange as dbGet,
  listPolicyChanges as dbList,
  updatePolicyChangeStatus as dbUpdate,
} from "../persistence/policy-change-store.js";
import { ulid } from "ulid";

export type ChangeServiceErrorCode =
  | "CHANGE_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "PACK_NOT_FOUND"
  | "APPLY_FAILED";

export class ChangeServiceError extends Error {
  constructor(
    public code: ChangeServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChangeServiceError";
  }
}

export class PolicyChangeService {
  constructor(
    private packStore: PolicyPackStore,
  ) {}

  createChange(data: {
    packId: string;
    proposedRules: PolicyPack["rules"];
    proposedName?: string;
    proposedDescription?: string;
    recommendationIds?: string[];
  }): PolicyChange {
    const pack = this.packStore.get(data.packId);
    if (!pack) throw new ChangeServiceError("PACK_NOT_FOUND", `Pack ${data.packId} not found`);

    const proposed: PolicyPack = {
      ...pack,
      rules: data.proposedRules,
      name: data.proposedName ?? pack.name,
      description: data.proposedDescription ?? pack.description,
    };

    return dbCreate({
      packId: data.packId,
      originalPackJson: JSON.stringify(pack),
      proposedPackJson: JSON.stringify(proposed),
      recommendationIds: data.recommendationIds,
    });
  }

  approveChange(id: string, reason?: string): PolicyChange {
    const change = dbGet(id);
    if (!change) throw new ChangeServiceError("CHANGE_NOT_FOUND", `Change ${id} not found`);
    try {
      assertValidTransition(change.status, "approved");
    } catch {
      throw new ChangeServiceError("INVALID_TRANSITION", `Cannot approve change in status ${change.status}`);
    }
    const updated = dbUpdate(id, "approved", reason);
    return updated!;
  }

  applyChange(id: string): PolicyChange {
    const change = dbGet(id);
    if (!change) throw new ChangeServiceError("CHANGE_NOT_FOUND", `Change ${id} not found`);

    if (change.status === "applied") return change;

    if (change.status !== "approved") {
      throw new ChangeServiceError("INVALID_TRANSITION", `Cannot apply change in status ${change.status}`);
    }

    const proposed = JSON.parse(change.proposedPackJson) as PolicyPack;
    const existing = this.packStore.get(change.packId);

    if (!existing) {
      dbUpdate(id, "approved", "Pack no longer exists");
      throw new ChangeServiceError("PACK_NOT_FOUND", `Pack ${change.packId} has been removed`);
    }

    try {
      this.packStore.update(change.packId, {
        rules: proposed.rules,
        name: proposed.name,
        description: proposed.description,
      });
      const updated = dbUpdate(id, "applied");
      return updated!;
    } catch (err) {
      dbUpdate(id, "approved", `Apply failed: ${String(err)}`);
      throw new ChangeServiceError("APPLY_FAILED", String(err));
    }
  }

  getChange(id: string): PolicyChange | undefined {
    return dbGet(id);
  }

  listChanges(limit = 50, offset = 0): PolicyChange[] {
    return dbList(limit, offset);
  }
}
