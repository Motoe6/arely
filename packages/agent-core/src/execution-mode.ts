import type { ExecutionResult } from "./types.js";

export interface ExecutionMode {
  readonly name: string;
  run(session: unknown, input: string): Promise<ExecutionResult>;
}

export type { ExecutionResult };
