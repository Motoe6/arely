/* eslint-disable @typescript-eslint/no-deprecated */
import { ulid } from "ulid";
import { getConfig } from "../config/index.js";
import { getDb } from "../persistence/database.js";
import { sessions } from "../persistence/schema.js";
import { eq } from "drizzle-orm";
import { updateSessionState } from "../persistence/session-store.js";
import { getSessionMessages } from "../persistence/message-store.js";
import type { SSEBus } from "./sse.js";
import type { AgentEvent, SessionInterruptedEvent, SessionRecoveredEvent } from "../types/events.js";
import type { SessionMessage } from "../types.js";
import { logger } from "../logger.js";

export interface RecoveredSession {
  id: string;
  state: string;
  messages: SessionMessage[];
}

export function recoverSessions(): RecoveredSession[] {
  const config = getConfig();
  const recovered: RecoveredSession[] = [];

  const runningSessions = getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.state, "running"))
    .all() as { id: string; state: string }[];

  for (const session of runningSessions) {
    updateSessionState(session.id, "interrupted", "Process restarted");
    logger.info("recovery", `Session ${session.id} marked as interrupted`, {
      sessionId: session.id,
    });
    recovered.push({
      id: session.id,
      state: "interrupted",
      messages: [],
    });
  }

  if (config.ARELY_AUTO_RECOVER_INTERRUPTED) {
    logger.info("recovery", `Auto-recover enabled for ${recovered.length} sessions`, {
      metadata: { count: recovered.length },
    });

    for (const rs of recovered) {
      const msgs = getSessionMessages(rs.id);
      rs.messages = msgs.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
      }));
    }
  }

  return recovered;
}

export function emitRecoveryEvents(emit: (event: AgentEvent) => void, recovered: RecoveredSession[]): void {
  for (const rs of recovered) {
    const interrupted: SessionInterruptedEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_interrupted",
      sessionId: rs.id,
      reason: "process_restart",
    };
    emit(interrupted);

    const recoveredEvent: SessionRecoveredEvent = {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_recovered",
      sessionId: rs.id,
      previousState: "running",
    };
    emit(recoveredEvent);
  }
}

/* eslint-disable-next-line @typescript-eslint/require-await */
export async function resumeSession(
  sse: SSEBus,
  sessionId: string,
  callback: (messages: SessionMessage[]) => void,
): Promise<void> {
  const msgs = getSessionMessages(sessionId);
  const sessionMsgs: SessionMessage[] = msgs.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: new Date(m.createdAt).getTime(),
  }));
  updateSessionState(sessionId, "running");
  callback(sessionMsgs);
}
