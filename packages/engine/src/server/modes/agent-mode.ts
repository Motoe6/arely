import { getConfig } from "../../config/index.js";
import { runAgentLoop } from "../agent-loop.js";
import type { ExecutionMode, ExecutionResult } from "../execution-mode.js";
import type { AgentSession } from "../session.js";
import { injectMemoryIntoContext, setEpochSummarizer } from "../../llm/context-epoch-service.js";
import { decisionService, setOutcomeUpdatedCallback } from "../../llm/decision-service.js";
import { extractMemories, extractEpochSummary } from "../../llm/auto-memory-extractor.js";
import { DecisionOutcomeLearner } from "../../llm/decision-outcome-learner.js";
import { MetaReasoner } from "../../llm/meta-reasoner.js";
import { StrategySelector } from "../../llm/strategy-selector.js";
import { StrategyEvaluator } from "../../llm/strategy-evaluator.js";
import { memoryService } from "../../llm/memory-service.js";
import { modelPerformanceService } from "../../llm/model-performance-service.js";
import { GoalResumeService } from "../../llm/goal-resume-service.js";

export class AgentModeExecution implements ExecutionMode {
  readonly name = "agent";

  async run(session: AgentSession, _input: string): Promise<ExecutionResult> {
    const cfg = getConfig();

    const outcomeLearner = new DecisionOutcomeLearner(session.llm, session.abortSignal);
    const metaReasoner = new MetaReasoner();
    const strategySelector = new StrategySelector(metaReasoner);
    const strategyEvaluator = new StrategyEvaluator();

    setEpochSummarizer(async (epochId, messages) => {
      try {
        return await extractEpochSummary(messages, { llm: session.llm, signal: session.abortSignal });
      } catch {
        return "";
      }
    });

    setOutcomeUpdatedCallback((decisionId) => {
      outcomeLearner.learnFromOutcome(decisionId);
      modelPerformanceService.recordFromDecision(decisionId).catch(() => {});
    });

    let currentStrategy: string | undefined;
    const currentModel = session.modelId;
    const currentProvider = cfg.ARELY_PROVIDER;

    const result = await runAgentLoop({
      llm: session.llm,
      messages: session.messages,
      modelId: session.modelId,
      tools: session.tools,
      emit: (event) => { session.sse.emit(session.id, event); },
      sessionId: session.id,
      maxIterations: cfg.ARELY_MAX_ITERATIONS,
      signal: session.abortSignal,
      onMessage: (role, content) => session.pushMessage(role, content),
      getMemoryContext: async (msgs) => {
        const contexts: typeof msgs = [];

        const metaCtx = await metaReasoner.buildMetaContextString(session.id);
        const stratPerf = await strategyEvaluator.buildStrategyContext(session.id);
        const metaParts = [metaCtx, stratPerf].filter(Boolean).join("\n\n");
        if (metaParts) {
          contexts.push({ role: "system", content: `[Self-Knowledge]\n${metaParts}`, timestamp: Date.now() });
        }

        const goalResumeService = new GoalResumeService();
        const resumeCtx = goalResumeService.injectResumeContext(session.id);
        contexts.push(...resumeCtx);

        const strategy = await strategySelector.recommend(session.id);
        currentStrategy = strategy.strategy;
        contexts.push({
          role: "system",
          content: `[Strategy]\n${strategy.label}\n${strategy.instruction}`,
          timestamp: Date.now(),
        });

        const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const memoryCtx = await injectMemoryIntoContext(session.id, lastUserMsg.content, 8);
          contexts.push(...memoryCtx);
        }

        return contexts;
      },
      onDecision: async (decision) => {
        await decisionService.logDecision({
          sessionId: session.id,
          decisionType: decision.decisionType,
          decision: decision.decision,
          rationale: decision.rationale,
          confidence: decision.confidence,
          proposalId: decision.proposalId,
          templateId: decision.templateId,
          metadata: {
            ...decision.metadata,
            ...(currentStrategy ? { strategy: currentStrategy } : {}),
            model: currentModel,
            provider: currentProvider,
          },
        });
      },
    });

    this.extractConversationMemory(session);
    this.learnFromSessionOutcomes(session, outcomeLearner);
    this.reflectOnSession(session, metaReasoner);
    this.evaluateStrategies(session, strategyEvaluator);

    return result;
  }

  private extractConversationMemory(session: AgentSession): void {
    extractMemories(session.messages.slice(-20), {
      llm: session.llm,
      signal: session.abortSignal,
    }).then((memories) => {
      for (const mem of memories) {
        memoryService.setMemory(
          session.id,
          mem.type,
          mem.key,
          mem.value,
          mem.confidence,
          mem.source,
          mem.tags,
        ).catch(() => {});
      }
    }).catch(() => {});
  }

  private learnFromSessionOutcomes(session: AgentSession, learner: DecisionOutcomeLearner): void {
    learner.learnFromSessionOutcomes(session.id).catch(() => {});
  }

  private reflectOnSession(session: AgentSession, reasoner: MetaReasoner): void {
    reasoner.reflectOnSession(session.id).catch(() => {});
  }

  private evaluateStrategies(session: AgentSession, evaluator: StrategyEvaluator): void {
    evaluator.storeStrategySummary(session.id).catch(() => {});
  }
}
