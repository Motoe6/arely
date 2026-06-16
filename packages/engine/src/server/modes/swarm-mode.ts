import { ulid } from "ulid";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";
import type { SessionMessage } from "../../types.js";
import type { AgentEvent } from "../../types/events.js";
import type { LLMAdapter } from "@arelyos/llm-core";
import type { AgentExecutor } from "../../llm/swarm-orchestrator.js";
import type { SwarmAgentRole } from "../../llm/swarm-task-types.js";
import { ParallelSwarmOrchestrator } from "../../llm/parallel-swarm-orchestrator.js";
import { registerSwarmExecution } from "../../routes/swarm-routes.js";
import { selectRoles, loadProviderSummary, getProviderCategoryStats, runLearningCycle, recordPerformance } from "@arelyos/agent-core/swarm/index.js";
import type { RoleAssignment, TaskCategory, RolePerformanceRecord } from "@arelyos/agent-core/swarm/index.js";

function createAgentExecutor(llm: LLMAdapter, signal?: AbortSignal, roleMap?: Map<string, RoleAssignment>): AgentExecutor {
  return async (role, systemPrompt, task, context) => {
    const roleName = role as string;
    const assignment = roleMap?.get(roleName);
    const modelId = assignment ? `${assignment.provider}:${assignment.model}` : undefined;

    const messages: SessionMessage[] = [
      { role: "system", content: systemPrompt, timestamp: Date.now() },
      { role: "user", content: `${task}\n\nContext:\n${context}`, timestamp: Date.now() },
    ];
    let result = "";
    for await (const response of llm.complete(messages, signal, modelId as any)) {
      if (response.type !== "delta") {
        result += response.content ?? "";
      }
    }
    return result;
  };
}

export class SwarmModeExecution implements ExecutionMode {
  readonly name = "swarm";

  constructor(private category?: TaskCategory) {}

  async run(session: AgentSession, input: string): Promise<ExecutionResult> {
    if (session.abortSignal.aborted) {
      return { content: "Swarm cancelled", turns: 0 };
    }

    // T15.4 Learning cycle — adjust weights from historical outcomes
    const learnedWeights = runLearningCycle();

    // Dynamic role selection with learned weights
    let assignments: RoleAssignment[] = [];
    try {
      const summary = loadProviderSummary();
      if (summary) {
        const stats = getProviderCategoryStats(summary);
        assignments = selectRoles({
          taskCategory: this.category ?? "coding",
          providerStats: stats,
          learnedWeights,
        });
      }
    } catch {
      // No benchmark data available; run with defaults
    }

    const roleMap = new Map<string, RoleAssignment>();
    for (const a of assignments) {
      roleMap.set(a.role, a);
    }

    // Emit role selection events
    for (const a of assignments) {
      const event: AgentEvent = {
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "swarm_role_selected",
        sessionId: session.id,
        role: a.role,
        provider: a.provider,
        model: a.model,
        score: a.score,
        confidence: a.confidence,
      };
      session.sse.emit(session.id, event);
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

    const executor = createAgentExecutor(session.llm, session.abortSignal, roleMap);
    const orchestrator = new ParallelSwarmOrchestrator(executor);

    const startMs = Date.now();

    try {
      const result = await orchestrator.run(input);
      registerSwarmExecution(swarmId, "completed", result);

      const synthesis = result.synthesis || result.review || Object.values(result.outputs).join("\n\n");
      session.pushMessage("assistant", synthesis);

      // Record role performance for T15.4
      for (const a of assignments) {
        const id = a.role;
        const taskOutput = result.outputs[id] ?? synthesis;
        const record: RolePerformanceRecord = {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          category: this.category ?? "coding",
          role: a.role,
          provider: a.provider,
          model: a.model,
          success: true,
          latencyMs: Date.now() - startMs,
          utility: a.score,
          score: a.score,
        };
        recordPerformance(record);
      }

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

      // Record failure for T15.4
      for (const a of assignments) {
        const record: RolePerformanceRecord = {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          category: this.category ?? "coding",
          role: a.role,
          provider: a.provider,
          model: a.model,
          success: false,
          latencyMs: Date.now() - startMs,
          utility: 0,
          score: a.score * 0.2,
        };
        recordPerformance(record);
      }

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