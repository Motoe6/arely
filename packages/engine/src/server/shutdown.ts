import { ulid } from "ulid";
import type { SSEBus } from "./sse.js";
import type { SessionManager } from "./session-manager.js";
import { getConfig } from "../config/index.js";
import { close } from "../persistence/database.js";
import { logger } from "../logger.js";
import type {
  AgentEvent,
  ProcessShutdownStartedEvent,
  ProcessShutdownCompletedEvent,
} from "../types/events.js";

let draining = false;
let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

export interface GracefulShutdownOptions {
  sse: SSEBus;
  sessionManager: SessionManager;
  emit: (event: AgentEvent) => void;
  reason?: string;
  getActiveRequests?: () => number;
  onDrainComplete?: () => void;
}

export function startDrain(opts: GracefulShutdownOptions): Promise<void> {
  draining = true;
  const config = getConfig();
  const reason = opts.reason ?? "SIGTERM";
  const timeoutMs = config.SHUTDOWN_TIMEOUT_MS;

  const startedEvent: ProcessShutdownStartedEvent = {
    id: ulid(),
    version: 1,
    timestamp: Date.now(),
    type: "process_shutdown_started",
    reason,
    timeoutMs,
  };
  opts.emit(startedEvent);

  logger.info("shutdown", `Shutdown started: ${reason}`, {
    metadata: { timeoutMs },
  });

  forceExitTimer = setTimeout(() => {
    logger.error("shutdown", "Shutdown timeout — force exit");
    process.exit(1);
  }, timeoutMs);
  forceExitTimer.unref();

  return new Promise<void>((resolve) => {
    try {
      opts.sessionManager.cancelAllSessions();
    } catch (err) {
      logger.error("shutdown", "Error cancelling sessions", { error: err });
    }

    try {
      opts.sse.removeAllClients("default");
    } catch (err) {
      logger.error("shutdown", "Error draining SSE clients", { error: err });
    }

    const waitForRequests = () => {
      const active = opts.getActiveRequests?.() ?? 0;
      if (active > 0) {
        logger.info("shutdown", `Waiting for ${active} active requests`, { metadata: { active } });
        setTimeout(waitForRequests, 100);
        return;
      }

      try {
        close();
      } catch (err) {
        logger.error("shutdown", "Error closing DB", { error: err });
      }

      if (forceExitTimer) clearTimeout(forceExitTimer);

      const completedEvent: ProcessShutdownCompletedEvent = {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "process_shutdown_completed",
        ok: true,
      };
      opts.emit(completedEvent);

      logger.info("shutdown", "Drain complete");
      opts.onDrainComplete?.();
      resolve();
    };

    setTimeout(waitForRequests, 200);
  });
}

export function isDraining(): boolean {
  return draining;
}

export function forceExit(): void {
  if (forceExitTimer) clearTimeout(forceExitTimer);
  logger.error("shutdown", "Force exit on second signal");
  process.exit(1);
}
