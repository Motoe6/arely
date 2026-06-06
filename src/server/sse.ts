import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type { AgentEvent } from "../types/events.js";
import { getConfig } from "../config/index.js";
import { persistEvent, getEventsAfter, getLatestSequence } from "../persistence/event-store.js";

type SessionClients = Map<string, Set<ServerResponse>>;
type SessionSequences = Map<string, number>;

export class SSEBus {
  private emitter = new EventEmitter();
  private sessionClients: SessionClients = new Map();
  private sessionSequences: SessionSequences = new Map();
  private listenerMap = new Map<(event: AgentEvent) => void, (sid: string, event: AgentEvent) => void>();

  on(sessionId: string, handler: (event: AgentEvent) => void): () => void {
    const wrapped = (_sid: string, event: AgentEvent) => {
      if (_sid === sessionId) handler(event);
    };
    this.listenerMap.set(handler, wrapped);
    this.emitter.on("sse", wrapped);
    return () => {
      this.emitter.off("sse", wrapped);
      this.listenerMap.delete(handler);
    };
  }

  off(sessionId: string, handler: (event: AgentEvent) => void): void {
    const wrapped = this.listenerMap.get(handler);
    if (wrapped) {
      this.emitter.off("sse", wrapped);
      this.listenerMap.delete(handler);
    }
  }

  emit(sessionId: string, event: AgentEvent): void {
    const sequence = persistEvent(sessionId, event);

    this.emitter.emit("sse", sessionId, event);
    this.sessionSequences.set(sessionId, sequence);

    const clients = this.sessionClients.get(sessionId);
    if (clients) {
      const data = `event: ${event.type}\nid: ${sequence}\nversion: ${event.version}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        try {
          res.write(data);
        } catch {
          clients.delete(res);
        }
      }
    }
  }

  addClient(sessionId: string, res: ServerResponse, lastEventId?: string, onClose?: () => void): void {
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set());
    }
    this.sessionClients.get(sessionId)!.add(res);

    const lastSeq = lastEventId ? Number(lastEventId) : 0;
    if (lastEventId !== undefined) {
      const batchSize = getConfig().DEFAULT_REPLAY_BATCH_SIZE;
      const missed = getEventsAfter(sessionId, lastSeq, batchSize);
      for (const entry of missed) {
        try {
          const replayData = `event: ${entry.eventType}\nid: ${entry.sequence}\nversion: ${entry.eventVersion}\ndata: ${JSON.stringify(entry.eventData)}\n\n`;
          res.write(replayData);
        } catch {
          break;
        }
      }
    }

    res.write(`event: connected\ndata: {"sessionId":"${sessionId}","replayed":${lastSeq}}\n\n`);

    res.on("close", () => {
      this.sessionClients.get(sessionId)?.delete(res);
      onClose?.();
    });
  }

  getSequence(sessionId: string): number {
    return this.sessionSequences.get(sessionId) ?? getLatestSequence(sessionId);
  }

  removeAllClients(sessionId: string): void {
    const clients = this.sessionClients.get(sessionId);
    if (clients) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      this.sessionClients.delete(sessionId);
    }
    this.sessionSequences.delete(sessionId);
  }
}
