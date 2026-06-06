import { getConfig } from "../../config/index.js";
import { runAgentLoop } from "../agent-loop.js";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";

export class AgentModeExecution implements ExecutionMode {
  readonly name = "agent";

  async run(session: AgentSession, _input: string): Promise<ExecutionResult> {
    const cfg = getConfig();
    return runAgentLoop({
      llm: session.llm,
      messages: session.messages,
      tools: session.tools,
      emit: (event) => { session.sse.emit(session.id, event); },
      sessionId: session.id,
      maxIterations: cfg.OPENCODE_MAX_ITERATIONS,
      signal: session.abortSignal,
    });
  }
}
