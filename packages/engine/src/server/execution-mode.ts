import type { AgentSession } from "./session.js";

export interface ExecutionResult {
  content: string;
  turns: number;
}

export interface ExecutionMode {
  readonly name: string;
  run(session: AgentSession, input: string): Promise<ExecutionResult>;
}
