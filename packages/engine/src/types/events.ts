interface BaseEvent {
  id: string;
  version: 1;
  timestamp: number;
  correlationId?: string;
  traceId?: string;
}

export type SessionStartedEvent = BaseEvent & {
  type: "session_started";
  sessionId: string;
  query: string;
  model: string;
  toolMode: "native" | "text";
};

export type SessionCompletedEvent = BaseEvent & {
  type: "session_completed";
  sessionId: string;
  reason: string;
  error?: string;
};

export type SessionStateChangedEvent = BaseEvent & {
  type: "session_state_change";
  sessionId: string;
  state: string;
};

export type ToolCallPendingEvent = BaseEvent & {
  type: "tool_call_pending";
  toolCallId: string;
  toolName: string;
  args: unknown;
  metadata?: Record<string, string>;
};

export type ToolCallTimedOutEvent = BaseEvent & {
  type: "tool_call_timed_out";
  toolCallId: string;
  durationMs: number;
};

export type ToolCallStartedEvent = BaseEvent & {
  type: "tool_call_started";
  toolCallId: string;
  toolName: string;
  args: unknown;
  metadata?: Record<string, string>;
};

export type ToolCallProgressEvent = BaseEvent & {
  type: "tool_call_progress";
  toolCallId: string;
  progress: string;
};

export type ToolCallCompletedEvent = BaseEvent & {
  type: "tool_call_completed";
  toolCallId: string;
  result: unknown;
  durationMs: number;
};

export type ToolCallFailedEvent = BaseEvent & {
  type: "tool_call_failed";
  toolCallId: string;
  error: string;
  durationMs: number;
};

export type ToolCallCancelledEvent = BaseEvent & {
  type: "tool_call_cancelled";
  toolCallId: string;
  reason?: string;
};

export type PermissionRequestedEvent = BaseEvent & {
  type: "permission_requested";
  requestId: string;
  toolName: string;
  args: unknown;
  mode: string;
};

export type PermissionGrantedEvent = BaseEvent & {
  type: "permission_granted";
  requestId: string;
};

export type PermissionDeniedEvent = BaseEvent & {
  type: "permission_denied";
  requestId: string;
};

export type StreamingTextEvent = BaseEvent & {
  type: "streaming_text";
  content: string;
};

export type SessionMessageEvent = BaseEvent & {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
};

export type CircuitOpenedEvent = BaseEvent & {
  type: "circuit_opened";
  toolName: string;
  failureCount: number;
  threshold: number;
};

export type CircuitHalfOpenedEvent = BaseEvent & {
  type: "circuit_half_opened";
  toolName: string;
};

export type CircuitClosedEvent = BaseEvent & {
  type: "circuit_closed";
  toolName: string;
};

export type RateLimitExceededEvent = BaseEvent & {
  type: "rate_limit_exceeded";
  toolName: string;
  sessionId: string;
  limit: number;
  windowMs: number;
};

export type RetryAttemptEvent = BaseEvent & {
  type: "retry_attempt";
  toolName: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
};

export type SessionThinkingEvent = BaseEvent & {
  type: "session_thinking";
  sessionId: string;
};

export type AssistantMessageCreatedEvent = BaseEvent & {
  type: "assistant_message_created";
  sessionId: string;
  messageId: string;
  content: string;
};

export type AssistantMessageStreamDeltaEvent = BaseEvent & {
  type: "assistant_message_stream_delta";
  sessionId: string;
  delta: string;
};

export type AssistantMessageCompletedEvent = BaseEvent & {
  type: "assistant_message_completed";
  sessionId: string;
  messageId: string;
  content: string;
};

export type ToolResultReceivedEvent = BaseEvent & {
  type: "tool_result_received";
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: string;
};

export type AgentLoopCompletedEvent = BaseEvent & {
  type: "agent_loop_completed";
  sessionId: string;
  turns: number;
};

export type AgentLoopFailedEvent = BaseEvent & {
  type: "agent_loop_failed";
  sessionId: string;
  error: string;
  turns: number;
};

export type ProcessShutdownStartedEvent = BaseEvent & {
  type: "process_shutdown_started";
  reason: string;
  timeoutMs: number;
};

export type ProcessShutdownCompletedEvent = BaseEvent & {
  type: "process_shutdown_completed";
  ok: boolean;
};

export type SessionRecoveredEvent = BaseEvent & {
  type: "session_recovered";
  sessionId: string;
  previousState: string;
};

export type SessionInterruptedEvent = BaseEvent & {
  type: "session_interrupted";
  sessionId: string;
  reason: string;
};

export type MetricRecordedEvent = BaseEvent & {
  type: "metric_recorded";
  name: string;
  value: number;
  labels?: Record<string, string>;
};

export type PlanCreatedEvent = BaseEvent & {
  type: "plan_created";
  planId: string;
  sessionId: string;
  goal: string;
  stepCount: number;
};

export type PlanStepStartedEvent = BaseEvent & {
  type: "plan_step_started";
  planId: string;
  stepId: string;
  description: string;
  tool?: string;
};

export type PlanStepCompletedEvent = BaseEvent & {
  type: "plan_step_completed";
  planId: string;
  stepId: string;
  result: string;
};

export type PlanStepFailedEvent = BaseEvent & {
  type: "plan_step_failed";
  planId: string;
  stepId: string;
  error: string;
};

export type WorkflowCompletedEvent = BaseEvent & {
  type: "workflow_completed";
  planId: string;
  sessionId: string;
  stepCount: number;
};

export type WorkflowFailedEvent = BaseEvent & {
  type: "workflow_failed";
  planId: string;
  sessionId: string;
  error: string;
  stepCount: number;
};

export type PolicyTriggeredEvent = BaseEvent & {
  type: "policy_triggered";
  ruleId: string;
  action: string;
  payload: Record<string, unknown>;
};

export type PolicyExecutionEvent = BaseEvent & {
  type: "policy_execution";
  ruleId: string;
  actionType: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  error?: string;
};

export type PolicyChangeCreatedEvent = BaseEvent & {
  type: "policy_change_created";
  changeId: string;
  packId: string;
  status: "draft";
};

export type PolicyChangeApprovedEvent = BaseEvent & {
  type: "policy_change_approved";
  changeId: string;
  packId: string;
  status: "approved";
};

export type PolicyChangeAppliedEvent = BaseEvent & {
  type: "policy_change_applied";
  changeId: string;
  packId: string;
  status: "applied";
};

export type WorkflowExportedEvent = BaseEvent & {
  type: "workflow_exported";
  workflowId: string;
  exportedAt: string;
};

export type PackageInstalledEvent = BaseEvent & {
  type: "package_installed";
  packageId: string;
  name: string;
  pkgVersion: string;
};

export type PackageRemovedEvent = BaseEvent & {
  type: "package_removed";
  packageId: string;
  name: string;
  pkgVersion: string;
};

export type PackageReloadedEvent = BaseEvent & {
  type: "package_reloaded";
  packageCount: number;
};

export type TemplateCreatedEvent = BaseEvent & {
  type: "template_created";
  templateId: string;
  name: string;
  source: string;
};

export type TemplateDeletedEvent = BaseEvent & {
  type: "template_deleted";
  templateId: string;
  name: string;
  source: string;
};

export type WorkflowImportedEvent = BaseEvent & {
  type: "workflow_imported";
  workflowId: string;
  importedAt: string;
  sourceFormatVersion: string;
};

export type ModelSelectedEvent = BaseEvent & {
  type: "model_selected";
  sessionId: string;
  modelId: string;
  modelName: string;
};

export type ModelRequestStartedEvent = BaseEvent & {
  type: "model_request_started";
  sessionId: string;
  modelId: string;
  requestId: string;
};

export type ModelRequestCompletedEvent = BaseEvent & {
  type: "model_request_completed";
  sessionId: string;
  modelId: string;
  requestId: string;
  latencyMs: number;
  success: boolean;
};

export type ModelRequestFailedEvent = BaseEvent & {
  type: "model_request_failed";
  sessionId: string;
  modelId: string;
  requestId: string;
  latencyMs: number;
  error: string;
};

export type WorkflowEvolvedEvent = BaseEvent & {
  type: "workflow_evolved";
  workflowId: string;
  templateId: string;
  templateName: string;
  adaptedParams: Record<string, unknown>;
  diagnostics: Array<{ phase: string; kind: string; message: string }>;
};

export type FeedbackSubmittedEvent = BaseEvent & {
  type: "feedback_submitted";
  workflowId: string;
  templateId?: string;
  source: "evolved" | "template" | "manual" | "imported";
  success: boolean;
};

export type TemplateEvolvedEvent = BaseEvent & {
  type: "template_evolved";
  templateId: string;
  proposalId: string;
  oldVersion: string;
  newVersion: string;
  parameter: string;
  oldValue: unknown;
  newValue: unknown;
};

export type EvolutionProposalCreatedEvent = BaseEvent & {
  type: "evolution_proposal_created";
  proposalId: string;
  templateId: string;
  parameter: string;
  confidence: number;
};

export type EvolutionProposalApprovedEvent = BaseEvent & {
  type: "evolution_proposal_approved";
  proposalId: string;
  templateId: string;
  parameter: string;
};

export type EvolutionProposalRejectedEvent = BaseEvent & {
  type: "evolution_proposal_rejected";
  proposalId: string;
  templateId: string;
  parameter: string;
};

export type SwarmRoleSelectedEvent = BaseEvent & {
  type: "swarm_role_selected";
  sessionId: string;
  role: string;
  provider: string;
  model: string;
  score: number;
  confidence: number;
  reason: string;
  weights: {
    historical: number;
    utility: number;
    availability: number;
    cost: number;
    latency: number;
  };
};

export type SwarmLearningUpdateEvent = BaseEvent & {
  type: "swarm_learning_update";
  sessionId: string;
  category: string;
  weights: {
    historicalScore: number;
    utility: number;
    availability: number;
    costEfficiency: number;
    latencyScore: number;
  };
};

export type SwarmExecutionModeEvent = BaseEvent & {
  type: "swarm_execution_mode";
  sessionId?: string;
  mode: "local" | "distributed";
  coordinatorUrl?: string;
  workerCount?: number;
};

export type TraceEvent = BaseEvent & {
  type: "trace";
  sessionId?: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  durationMs: number;
  status: "ok" | "error";
  tags?: Record<string, unknown>;
  error?: string;
};

export type AgentEvent =
  | SessionStartedEvent
  | SessionCompletedEvent
  | SessionStateChangedEvent
  | ToolCallPendingEvent
  | ToolCallStartedEvent
  | ToolCallProgressEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | ToolCallTimedOutEvent
  | ToolCallCancelledEvent
  | PermissionRequestedEvent
  | PermissionGrantedEvent
  | PermissionDeniedEvent
  | StreamingTextEvent
  | SessionMessageEvent
  | CircuitOpenedEvent
  | CircuitHalfOpenedEvent
  | CircuitClosedEvent
  | RateLimitExceededEvent
  | RetryAttemptEvent
  | SessionThinkingEvent
  | AssistantMessageCreatedEvent
  | AssistantMessageStreamDeltaEvent
  | AssistantMessageCompletedEvent
  | ToolResultReceivedEvent
  | AgentLoopCompletedEvent
  | AgentLoopFailedEvent
  | ProcessShutdownStartedEvent
  | ProcessShutdownCompletedEvent
  | SessionRecoveredEvent
  | SessionInterruptedEvent
  | MetricRecordedEvent
  | PlanCreatedEvent
  | PlanStepStartedEvent
  | PlanStepCompletedEvent
  | PlanStepFailedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | PolicyTriggeredEvent
  | PolicyExecutionEvent
  | PolicyChangeCreatedEvent
  | PolicyChangeApprovedEvent
  | PolicyChangeAppliedEvent
  | WorkflowExportedEvent
  | WorkflowImportedEvent
  | PackageInstalledEvent
  | PackageRemovedEvent
  | PackageReloadedEvent
  | TemplateCreatedEvent
  | TemplateDeletedEvent
  | ModelSelectedEvent
  | ModelRequestStartedEvent
  | ModelRequestCompletedEvent
  | ModelRequestFailedEvent
  | WorkflowEvolvedEvent
  | FeedbackSubmittedEvent
  | TemplateEvolvedEvent
  | EvolutionProposalCreatedEvent
  | EvolutionProposalApprovedEvent
  | EvolutionProposalRejectedEvent
  | SwarmRoleSelectedEvent
  | SwarmLearningUpdateEvent
  | SwarmExecutionModeEvent
  | TraceEvent;

export interface SSEEventData {
  event: AgentEvent["type"];
  id: string;
  version: number;
  data: string;
}
