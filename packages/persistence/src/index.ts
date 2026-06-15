// Infrastructure
export {
  connect,
  getDb,
  close,
  createInMemoryDb,
} from "./database.js"

// Schema tables (individual + namespace)
export {
  sessions,
  messages,
  toolCalls,
  permissionApprovals,
  approvalCache,
  eventLog,
  auditLog,
  config,
  plans,
  planSteps,
  agents,
  agentMemory,
  agentPipelines,
  pipelineSteps,
  pipelineRuns,
  pipelineStepRuns,
  workflows,
  workflowVersions,
  workflowRuns,
  workflowStepRuns,
  notificationQueue,
  notificationEvents,
  policyAuditEvents,
  policyChanges,
  scheduledTriggers,
  installedPackages,
  installedNodes,
  secrets,
  templateVersions,
  evolutionProposals,
  evolutionAudit,
  workflowFeedback,
  contextEpochs,
  epochMessages,
  memoryStore,
  decisionLog,
  modelPerformance,
  goals,
  goalPlans,
  milestones,
} from "./schema.js"
export * as schema from "./schema.js"

// Migrate
export {
  CREATE_TABLES,
  CREATE_INDEXES,
  MIGRATIONS,
  pushSchema,
} from "./migrate.js"

// Types
export * from "./types/index.js"

// Stores — approval-cache
export {
  setApproval,
  findMatchingApproval,
  clearSessionCache,
  expireOnceEntries,
} from "./approval-cache-store.js"

// Stores — audit
export {
  createAuditLog,
  getSessionAuditLogs,
} from "./audit-store.js"

// Stores — config
export {
  getConfigValue,
  setConfigValue,
  getAllConfig,
  deleteConfig,
} from "./config-store.js"

// Stores — context-epoch
export {
  createEpoch,
  getEpoch,
  getEpochsBySession,
  getCurrentEpoch,
  addEpochMessage,
  getEpochMessages,
  getRecentMessages,
  updateEpoch,
  getEpochMessageCount,
} from "./context-epoch-store.js"

// Stores — decision
export {
  createDecision,
  getDecision,
  queryDecisions,
  updateOutcome,
  countDecisions,
} from "./decision-store.js"

// Stores — event
export {
  persistEvent,
  persistSystemEvent,
  getEventsAfter,
  getSessionEvents,
  getLatestSequence,
} from "./event-store.js"

// Stores — evolution-audit
export {
  createAuditRecord,
  getAuditByTemplate,
  getAuditByProposal,
  listAudit,
} from "./evolution-audit-store.js"
export type {
  CreateAuditInput,
  AuditListOptions,
} from "./evolution-audit-store.js"

// Stores — feedback
export {
  createFeedback,
  getFeedbackByWorkflow,
  getFeedbackByTemplate,
  getTemplateMetrics,
  getFeedbackStats,
} from "./feedback-store.js"
export type {
  FeedbackRecord,
  CreateFeedbackInput,
  TemplateMetricsRow,
} from "./feedback-store.js"

// Stores — memory
export {
  setMemory,
  getMemory,
  searchMemories,
  deleteMemory,
  listBySession,
  evictExpired,
  evictByCount,
} from "./memory-store.js"

// Stores — message
export {
  createMessage,
  getSessionMessages,
  getMessageCount,
} from "./message-store.js"

// Stores — permission
export {
  createPermissionApproval,
} from "./permission-store.js"

// Stores — policy-audit
export {
  insertEvent,
  getTrace,
  listTraces,
  countTraces,
  prune,
} from "./policy-audit-store.js"
export type {
  PolicyAuditEvent,
  TraceSummary,
} from "./policy-audit-store.js"

// Stores — policy-change
export {
  createPolicyChange,
  getPolicyChange,
  listPolicyChanges,
  updatePolicyChangeStatus,
} from "./policy-change-store.js"

// Stores — proposal
export {
  createProposal,
  getProposal,
  listProposals,
  updateProposalStatus,
} from "./proposal-store.js"
export type {
  ProposalStatus,
  ProposalType,
  ProposalEvidence,
  ProposalRecord,
  CreateProposalInput,
} from "./proposal-store.js"

// Stores — run
export {
  createRun,
  getRun,
  listRuns,
  completeRun,
  createStepRun,
  completeStepRun,
  getRunSteps,
  getRunWithSteps,
} from "./run-store.js"
export type {
  WorkflowRunRecord,
  WorkflowStepRunRecord,
  RunWithSteps,
} from "./run-store.js"

// Stores — session
export {
  createSession,
  getSession,
  updateSessionState,
  listSessions,
} from "./session-store.js"

// Stores — template-version
export {
  createTemplateVersion,
  getTemplateVersion,
  listTemplateVersions,
} from "./template-version-store.js"

// Stores — goal
export {
  createGoal,
  getGoal,
  updateGoal,
  queryGoals,
  countGoals,
  deleteGoal,
} from "./goal-store.js"
export type { Goal, GoalStatus, GoalQuery } from "./types/goals.js"

// Stores — goal-plan
export {
  createGoalPlan,
  getGoalPlan,
  updateGoalPlan,
  queryGoalPlans,
  countGoalPlans,
  deleteGoalPlan,
} from "./goal-plan-store.js"
export type { GoalPlan, GoalPlanStatus, GoalPlanQuery } from "./types/plans.js"

// Stores — milestone
export {
  createMilestone,
  getMilestone,
  updateMilestone,
  queryMilestones,
  countMilestones,
  deleteMilestone,
} from "./milestone-store.js"
export type { Milestone, MilestoneStatus, MilestoneQuery } from "./types/milestones.js"

// Stores — tool-call
export {
  createToolCall,
  updateToolCallStatus,
  getToolCall,
  getSessionToolCalls,
} from "./tool-call-store.js"

// Stores — workflow
export {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  createWorkflowVersion,
  getWorkflowVersion,
  getWorkflowVersions,
  getWorkflowWithCurrentVersion,
  parseWorkflowDsl,
} from "./workflow-store.js"
export type {
  WorkflowRecord,
  WorkflowVersionRecord,
  CreateWorkflowOpts,
} from "./workflow-store.js"
