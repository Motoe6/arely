export { selectRoles, selectRole } from "./role-selector.js"
export type { SelectorInput } from "./role-selector.js"
export type {
  RoleAssignment,
  SwarmRole,
  TaskCategory,
  ProviderCategoryStats,
  RoleHistoryEntry,
} from "./role-types.js"
export { SWARM_ROLES, TASK_CATEGORIES, ROLE_CATEGORY_MAP } from "./role-types.js"
export { loadProviderSummary, getProviderCategoryStats, findBestProvider } from "./role-history.js"
export type { ProviderBenchmarkSummaryFile } from "./role-history.js"
export { computeEffectiveScore, computeAvailability, computeLatencyScore } from "./role-score.js"
export { recordPerformance, loadPerformanceHistory, getStatsByCategory, getStatsByRole } from "./role-performance-store.js"
export type { RolePerformanceRecord } from "./learning-types.js"
export {
  loadLearnedWeights,
  saveLearnedWeights,
  getWeightsForCategory,
  getWeightsForRole,
  runLearningCycle,
  predictScore,
} from "./role-learning.js"
export { optimizeWeights, mergeWeights } from "./weight-optimizer.js"
export type { LearnedWeights, WeightCategoryMap, ProviderRoleStats, CategoryStats } from "./learning-types.js"
export { DEFAULT_WEIGHTS, DEFAULT_WEIGHT_MAP } from "./learning-types.js"
