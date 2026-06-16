export type { MemoryType, MemorySource, MemoryRecord, MemorySearchQuery } from "./memory-types.js";
export type { ContextEpoch, EpochMessage, BuildContextOptions } from "./epoch-types.js";
export type { DecisionOutcome, MemorySnapshotEntry, DecisionRecord, DecisionQuery } from "./decision-types.js";

export { DEFAULT_MEMORY_LIMIT, MAX_MEMORIES, TYPE_LIMIT } from "./memory-types.js";

export { MemoryService, memoryService } from "./memory-service.js";

export type { MemoryScoredRecord, MemoryRetrievalOptions } from "./memory-retrieval-service.js";
export { MemoryRetrievalService, memoryRetrievalService } from "./memory-retrieval-service.js";

export type { EpochSummarizer, ContextStats, InjectedMemoryMessage } from "./context-epoch-service.js";
export {
  setEpochThreshold,
  setEpochSummarizer,
  initEpoch,
  addEpochMessageToSession,
  maybeRotateEpoch,
  summarizeEpoch,
  buildContext,
  injectMemoryIntoContext,
  getContextStats,
} from "./context-epoch-service.js";

export type { ExtractedMemory, AutoMemoryExtractorOptions } from "./auto-memory-extractor.js";
export { extractMemories, extractEpochSummary } from "./auto-memory-extractor.js";

export type { OutcomeLearning } from "./decision-outcome-learner.js";
export { DecisionOutcomeLearner } from "./decision-outcome-learner.js";

export type { DecisionStats } from "./meta-reasoner.js";
export { MetaReasoner } from "./meta-reasoner.js";

export type { Strategy, StrategyRecommendation } from "./strategy-selector.js";
export { StrategySelector } from "./strategy-selector.js";

export type { StrategyPerformance, StrategyConvergence } from "./strategy-evaluator.js";
export { StrategyEvaluator } from "./strategy-evaluator.js";

export type { ModelPerfRecord, TaskType } from "./model-performance-service.js";
export { TASK_TYPES, ModelPerformanceService, modelPerformanceService } from "./model-performance-service.js";

export type { OutcomeUpdatedCallback } from "./decision-service.js";
export { DecisionService, decisionService, setOutcomeUpdatedCallback } from "./decision-service.js";

export type {
  TaskProfile,
  ModelPerformanceSnapshot,
  ModelRecommendation,
  ExecutionFeedback,
} from "./model-selection-types.js";
export { SCORE_WEIGHTS } from "./model-selection-types.js";

export { TaskClassifier, taskClassifier } from "./task-classifier.js";
export { ModelSelector } from "./model-selector.js";

export type { Goal, GoalStatus, GoalQuery } from "./goal-service.js";
export { GoalService, goalService } from "./goal-service.js";

export type { GoalPlan, GoalPlanStatus, GoalPlanQuery, Milestone, MilestoneStatus, MilestoneQuery } from "./planning-service.js";
export { PlanningService, planningService } from "./planning-service.js";
