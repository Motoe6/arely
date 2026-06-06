import { ulid } from "ulid";
import type { SSEBus } from "../server/sse.js";
import type { PermissionMode, ApprovalScope } from "../types.js";
import type {
  PermissionRequestedEvent,
  PermissionGrantedEvent,
  PermissionDeniedEvent,
} from "../types/events.js";
import { getConfig } from "../config/index.js";
import { createPermissionApproval } from "../persistence/permission-store.js";
import { createAuditLog } from "../persistence/audit-store.js";
import { findMatchingApproval, setApproval } from "../persistence/approval-cache-store.js";

function getToolMode(tool: string): PermissionMode {
  const config = getConfig();
  if (tool === "websearch") return config.OPENCODE_PERMIT_WEBSEARCH;
  if (tool === "webfetch") return config.OPENCODE_PERMIT_WEBFETCH;
  return "ask";
}

export class PermissionGate {
  private pendingApprovals = new Map<
    string,
    {
      toolName: string;
      args: Record<string, unknown>;
      mode: PermissionMode;
      requestedAt: number;
      resolve: (granted: boolean) => void;
    }
  >();

  constructor(
    private sse: SSEBus,
    private sessionId: string,
  ) {}

  async check(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const mode = getToolMode(tool);
    if (mode === "deny") {
      createAuditLog({
        sessionId: this.sessionId,
        category: "permission",
        action: "permission_denied",
        actor: "config",
        target: tool,
        detail: { args, reason: "mode=deny" },
      });
      throw new Error(`Permission denied for ${tool}`);
    }
    if (mode === "allow") {
      createPermissionApproval({
        sessionId: this.sessionId,
        toolName: tool,
        args,
        mode: "allow",
        granted: true,
        responseTimeMs: 0,
      });
      createAuditLog({
        sessionId: this.sessionId,
        category: "permission",
        action: "permission_granted",
        actor: "config",
        target: tool,
        detail: { args, reason: "mode=allow" },
      });
      return true;
    }
    const cached = findMatchingApproval(this.sessionId, tool, args);
    if (cached?.granted) {
      createAuditLog({
        sessionId: this.sessionId,
        category: "permission",
        action: "approval_cache_hit",
        actor: "system",
        target: tool,
        detail: { args, cacheEntryId: cached.id, scope: cached.scope },
      });
      return true;
    }
    return this.prompt(tool, args, mode);
  }

  private prompt(tool: string, args: Record<string, unknown>, mode: PermissionMode): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = ulid();
      const requestedAt = Date.now();
      const timeoutMs = getConfig().PERMISSION_TIMEOUT_MS;

      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(id);
        const responseTimeMs = Date.now() - requestedAt;
        createPermissionApproval({
          sessionId: this.sessionId,
          toolName: tool,
          args,
          mode,
          granted: false,
          responseTimeMs,
        });
        createAuditLog({
          sessionId: this.sessionId,
          category: "permission",
          action: "permission_denied",
          actor: "system",
          target: tool,
          detail: { args, reason: "timeout" },
        });
        this.sse.emit(this.sessionId, {
          id: ulid(),
          version: 1,
          timestamp: Date.now(),
          type: "permission_denied",
          requestId: id,
        } satisfies PermissionDeniedEvent);
        resolve(false);
      }, timeoutMs);

      const event: PermissionRequestedEvent = {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "permission_requested",
        requestId: id,
        toolName: tool,
        args,
        mode,
      };
      this.sse.emit(this.sessionId, event);

      this.pendingApprovals.set(id, {
        toolName: tool,
        args,
        mode,
        requestedAt,
        resolve: (granted: boolean) => {
          clearTimeout(timeout);
          resolve(granted);
        },
      });
    });
  }

  resolve(id: string, granted: boolean, scope?: ApprovalScope): void {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    this.pendingApprovals.delete(id);

    const responseTimeMs = Date.now() - pending.requestedAt;

    createPermissionApproval({
      sessionId: this.sessionId,
      toolName: pending.toolName,
      args: pending.args,
      mode: pending.mode,
      granted,
      responseTimeMs,
    });
    createAuditLog({
      sessionId: this.sessionId,
      category: "permission",
      action: granted ? "permission_granted" : "permission_denied",
      actor: "user",
      target: pending.toolName,
      detail: { args: pending.args, mode: pending.mode, responseTimeMs },
    });

    if (granted) {
      setApproval({
        sessionId: scope === "forever" ? undefined : this.sessionId,
        toolName: pending.toolName,
        argsPattern: JSON.stringify(pending.args),
        scope: scope ?? "session",
        granted: true,
      });
    }

    if (granted) {
      this.sse.emit(this.sessionId, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "permission_granted",
        requestId: id,
      } satisfies PermissionGrantedEvent);
    } else {
      this.sse.emit(this.sessionId, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "permission_denied",
        requestId: id,
      } satisfies PermissionDeniedEvent);
    }

    pending.resolve(granted);
  }
}
