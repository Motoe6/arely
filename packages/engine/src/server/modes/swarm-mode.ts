import { ulid } from "ulid";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";
import type { SessionMessage } from "../../types.js";
import type { LLMAdapter } from "@arelyos/llm-core";
import type { AgentExecutor } from "../../llm/swarm-orchestrator.js";
import { ParallelSwarmOrchestrator } from "../../llm/parallel-swarm-orchestrator.js";
import { registerSwarmExecution } from "../../routes/swarm-routes.js";

function createAgentExecutor(llm: LLMAdapter, signal?: AbortSignal): AgentExecutor {
  return async (role, systemPrompt, task, context) => {
    const messages: SessionMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      { role: "user", content: `${task}\n\nContext:\n${context}`, timestamp: Date.now() },
    ];
    let result = "";
    for await (const response of llm.complete(messages, signal)) {
      if (response.type !== "delta") {
        result += response.content ?? "";
      }
    }
    return result;
  };
}

export class SwarmModeExecution implements ExecutionMode {
  readonly name = "swarm";

  async run(session: AgentSession, input: string): Promise<ExecutionResult> {
    if (session.abortSignal.aborted) {
      return { content: "Swarm cancelled", turns: 0 };
    }

    session.sse.emit(session.id, {
      id: ulid(),
      version: 1,
      timestamp: Date.now(),
      type: "session_thinking",
      sessionId: session.id,
    });

    const swarmId = `swarm-${ulid().slice(0, 16)}`;
    registerSwarmExecution(swarmId, "running");

    const executor = createAgentExecutor(session.llm, session.abortSignal);
    const orchestrator = new ParallelSwarmOrchestrator(executor);

    try {
      const result = await orchestrator.run(input);
      registerSwarmExecution(swarmId, "completed", result);

      const synthesis = result.synthesis || result.review || Object.values(result.outputs).join("\n\n");
      session.pushMessage("assistant", synthesis);

      session.sse.emit(session.id, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "assistant_message_completed",
        sessionId: session.id,
        messageId: ulid(),
        content: synthesis,
      });

      return { content: synthesis, turns: 1 };
    } catch (err) {
      registerSwarmExecution(swarmId, "failed");

      const errorMsg = err instanceof Error ? err.message : String(err);
      session.pushMessage("assistant", `Swarm execution failed: ${errorMsg}`);

      session.sse.emit(session.id, {
        id: ulid(),
        version: 1,
        timestamp: Date.now(),
        type: "agent_loop_failed",
        sessionId: session.id,
        error: errorMsg,
        turns: 0,
      });

      return { content: `Swarm failed: ${errorMsg}`, turns: 0 };
    }
  }
}