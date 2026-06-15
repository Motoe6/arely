import type { SSEBus } from "./sse.js";
import type { LLMAdapter } from "@arelyos/llm-core";
import type { ToolCallMode } from "../types.js";
import { AgentSession } from "./session.js";

export class SessionManager {
  private sessions = new Map<string, AgentSession>();

  createSession(
    sse: SSEBus,
    llm: LLMAdapter,
    config: {
      permissions: { websearch: string; webfetch: string };
      searchProvider?: "exa" | "parallel";
      model?: string;
      modelId?: string;
      toolMode?: ToolCallMode;
      mode?: "agent" | "planning" | "swarm";
      agentId?: string;
    },
  ): AgentSession {
    const session = new AgentSession(sse, llm, config);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  cancelSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.abort();
    this.sessions.delete(id);
    return true;
  }

  cancelAllSessions(): void {
    for (const [id, session] of this.sessions) {
      session.abort();
      this.sessions.delete(id);
    }
  }

  removeSession(id: string): boolean {
    return this.sessions.delete(id);
  }
}
