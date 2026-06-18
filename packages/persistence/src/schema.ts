import { sqliteTable, text, integer, real, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    state: text("state").notNull().default("idle"),
    query: text("query").notNull(),
    model: text("model").notNull(),
    toolMode: text("tool_mode").notNull().default("native"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [index("idx_sessions_created").on(table.createdAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [index("idx_messages_session").on(table.sessionId, table.sequence)],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    args: text("args").notNull(),
    status: text("status").notNull().default("pending"),
    result: text("result"),
    error: text("error"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    durationMs: integer("duration_ms"),
    provider: text("provider"),
    permissionMode: text("permission_mode").notNull().default("ask"),
    permissionGranted: integer("permission_granted"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [index("idx_tool_calls_session").on(table.sessionId)],
);

export const permissionApprovals = sqliteTable(
  "permission_approvals",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    args: text("args").notNull(),
    mode: text("mode").notNull(),
    granted: integer("granted").notNull(),
    respondedAt: text("responded_at").notNull().default("datetime('now')"),
    responseTimeMs: integer("response_time_ms"),
  },
  (table) => [index("idx_perm_approvals_session").on(table.sessionId)],
);

export const approvalCache = sqliteTable(
  "approval_cache",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    toolName: text("tool_name").notNull(),
    argsPattern: text("args_pattern").notNull(),
    scope: text("scope").notNull(),
    granted: integer("granted").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("idx_approval_cache_session").on(table.sessionId, table.toolName),
    index("idx_approval_cache_forever").on(table.toolName),
  ],
);

export const eventLog = sqliteTable(
  "event_log",
  {
    sequence: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventData: text("event_data").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    correlationId: text("correlation_id"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [index("idx_event_log_session").on(table.sessionId, table.sequence)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    category: text("category").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    target: text("target"),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_audit_session").on(table.sessionId),
    index("idx_audit_category").on(table.category),
  ],
);

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default("datetime('now')"),
});

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    agentId: text("agent_id"),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_plans_session").on(table.sessionId),
    index("idx_plans_agent").on(table.agentId),
  ],
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    goal: text("goal").notNull(),
    mode: text("mode").notNull().default("planning"),
    trigger: text("trigger").notNull().default("manual"),
    triggerConfig: text("trigger_config"),
    enabled: integer("enabled").notNull().default(1),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [index("idx_agents_enabled").on(table.enabled)],
);

export const agentMemory = sqliteTable(
  "agent_memory",
  {
    agentId: text("agent_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.key] }),
    index("idx_agent_memory_agent").on(table.agentId),
  ],
);

export const agentPipelines = sqliteTable(
  "agent_pipelines",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
);

export const pipelineSteps = sqliteTable(
  "pipeline_steps",
  {
    id: text("id").primaryKey(),
    pipelineId: text("pipeline_id").notNull().references(() => agentPipelines.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("agent"),
    agentId: text("agent_id").references(() => agents.id),
    toolName: text("tool_name"),
    stepOrder: integer("step_order").notNull(),
    dependsOn: text("depends_on").notNull().default("[]"),
    inputMapping: text("input_mapping"),
    outputKey: text("output_key"),
    timeoutMs: integer("timeout_ms"),
    retries: integer("retries"),
    retryDelayMs: integer("retry_delay_ms"),
    retryStrategy: text("retry_strategy"),
    idempotent: integer("idempotent", { mode: "boolean" }),
    retryableErrors: text("retryable_errors"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_pipeline_steps_pipeline").on(table.pipelineId),
  ],
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    pipelineId: text("pipeline_id").notNull().references(() => agentPipelines.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    stepsTotal: integer("steps_total").notNull().default(0),
    stepsCompleted: integer("steps_completed").notNull().default(0),
    replayOf: text("replay_of"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_pipeline_runs_pipeline").on(table.pipelineId),
  ],
);

export const pipelineStepRuns = sqliteTable(
  "pipeline_step_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    agentId: text("agent_id"),
    toolName: text("tool_name"),
    status: text("status").notNull().default("pending"),
    input: text("input"),
    output: text("output"),
    error: text("error"),
    errorKind: text("error_kind"),
    toolInputHash: text("tool_input_hash"),
    toolOutputHash: text("tool_output_hash"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    retryCount: integer("retry_count").notNull().default(0),
    log: text("log").notNull().default("[]"),
  },
  (table) => [
    index("idx_pipeline_step_runs_run").on(table.runId),
  ],
);

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    description: text("description"),
    currentVersionId: text("current_version_id"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [index("idx_workflows_updated").on(table.updatedAt)],
);

export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    workflowDsl: text("workflow_dsl").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_wf_versions_workflow").on(table.workflowId),
    uniqueIndex("idx_wf_versions_unique").on(table.workflowId, table.version),
  ],
);

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersion: integer("workflow_version").notNull(),
    status: text("status").notNull().default("running"),
    triggerInput: text("trigger_input"),
    replayOfRunId: text("replay_of_run_id"),
    replayFromStepId: text("replay_from_step_id"),
    startedAt: text("started_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    error: text("error"),
  },
  (table) => [
    index("idx_wf_runs_workflow").on(table.workflowId),
    index("idx_wf_runs_status").on(table.status),
    index("idx_wf_runs_started").on(table.startedAt),
    index("idx_wf_runs_replay_of").on(table.replayOfRunId),
  ],
);

export const workflowStepRuns = sqliteTable(
  "workflow_step_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    status: text("status").notNull().default("running"),
    input: text("input"),
    output: text("output"),
    error: text("error"),
    copiedFromStepRunId: text("copied_from_step_run_id"),
    startedAt: text("started_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("idx_wf_step_runs_run").on(table.runId),
    index("idx_wf_step_runs_copied").on(table.copiedFromStepRunId),
  ],
);

export const notificationQueue = sqliteTable(
  "notification_queue",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(),
    alertJson: text("alert_json").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    lastError: text("last_error"),
    nextRetryAt: text("next_retry_at"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_notification_queue_status").on(table.status),
    index("idx_notification_queue_next_retry").on(table.nextRetryAt),
    index("idx_notification_queue_idempotency").on(table.idempotencyKey),
  ],
);

export const policyAuditEvents = sqliteTable(
  "policy_audit_events",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_policy_audit_trace").on(table.traceId),
    index("idx_policy_audit_type").on(table.eventType),
    index("idx_policy_audit_created").on(table.createdAt),
  ],
);

export const notificationEvents = sqliteTable(
  "notification_events",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id").notNull().references(() => notificationQueue.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    attemptedAt: text("attempted_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_notification_events_notification").on(table.notificationId),
  ],
);

export const planSteps = sqliteTable(
  "plan_steps",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    tool: text("tool"),
    args: text("args"),
    dependsOn: text("depends_on").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
    result: text("result"),
    error: text("error"),
    order: integer("order").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_plan_steps_plan").on(table.planId),
    index("idx_plan_steps_status").on(table.status),
  ],
);

export const scheduledTriggers = sqliteTable(
  "scheduled_triggers",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    triggerMode: text("trigger_mode").notNull(),
    cronExpression: text("cron_expression"),
    intervalMs: integer("interval_ms"),
    enabled: integer("enabled").notNull().default(1),
    nextRunAt: text("next_run_at").notNull(),
    lastRunAt: text("last_run_at"),
    lastError: text("last_error"),
    runCount: integer("run_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_scheduled_triggers_workflow").on(table.workflowId),
    index("idx_scheduled_triggers_next_run").on(table.nextRunAt),
    index("idx_scheduled_triggers_enabled_next").on(table.enabled, table.nextRunAt),
  ],
);

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    valueEncrypted: text("value_encrypted").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_secrets_name").on(table.name),
  ],
);

export const installedPackages = sqliteTable(
  "installed_packages",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    description: text("description"),
    author: text("author"),
    packageDir: text("package_dir").notNull(),
    manifestVersion: integer("manifest_version").notNull().default(2),
    installedAt: text("installed_at").notNull().default("datetime('now')"),
    enabled: integer("enabled").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_installed_packages_name_version").on(table.name, table.version),
    index("idx_installed_packages_enabled").on(table.enabled),
  ],
);

export const installedNodes = sqliteTable(
  "installed_nodes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    nodeType: text("node_type").notNull().unique(),
    category: text("category"),
    description: text("description"),
    author: text("author"),
    entryPath: text("entry_path").notNull(),
    manifestVersion: integer("manifest_version").notNull().default(1),
    installedAt: text("installed_at").notNull().default("datetime('now')"),
    enabled: integer("enabled").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_installed_nodes_name_version").on(table.name, table.version),
    index("idx_installed_nodes_type").on(table.nodeType),
  ],
);

export const templateVersions = sqliteTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    version: text("version").notNull(),
    workflowYaml: text("workflow_yaml").notNull(),
    parametersJson: text("parameters_json").notNull(),
    source: text("source").notNull().default("evolution"),
    proposalId: text("proposal_id"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_tpl_versions_template").on(table.templateId),
    uniqueIndex("idx_tpl_versions_unique").on(table.templateId, table.version),
  ],
);

export const evolutionProposals = sqliteTable(
  "evolution_proposals",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    type: text("type").notNull(),
    parameter: text("parameter").notNull(),
    currentValue: text("current_value"),
    suggestedValue: text("suggested_value"),
    confidence: text("confidence").notNull(),
    evidence: text("evidence").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_evo_proposals_template").on(table.templateId),
    index("idx_evo_proposals_status").on(table.status),
    index("idx_evo_proposals_created").on(table.createdAt),
  ],
);

export const evolutionAudit = sqliteTable(
  "evolution_audit",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    templateVersion: text("template_version").notNull(),
    proposalId: text("proposal_id").notNull(),
    proposalTitle: text("proposal_title"),
    parameter: text("parameter").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    approvedBy: text("approved_by"),
    evidenceSnapshot: text("evidence_snapshot").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_evo_audit_template").on(table.templateId),
    index("idx_evo_audit_proposal").on(table.proposalId),
    index("idx_evo_audit_created").on(table.createdAt),
  ],
);

export const workflowFeedback = sqliteTable(
  "workflow_feedback",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    workflowVersionId: text("workflow_version_id"),
    templateId: text("template_id"),
    source: text("source").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms"),
    parameters: text("parameters"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_wf_feedback_workflow").on(table.workflowId),
    index("idx_wf_feedback_template").on(table.templateId),
    index("idx_wf_feedback_source").on(table.source),
    index("idx_wf_feedback_created").on(table.createdAt),
  ],
);

export const contextEpochs = sqliteTable(
  "context_epochs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    epochNumber: integer("epoch_number").notNull(),
    baselineContext: text("baseline_context").notNull().default(""),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_epochs_session").on(table.sessionId, table.epochNumber),
  ],
);

export const epochMessages = sqliteTable(
  "epoch_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    epochId: text("epoch_id").notNull().references(() => contextEpochs.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_epoch_messages_epoch").on(table.epochId, table.sequence),
    index("idx_epoch_messages_session").on(table.sessionId, table.sequence),
  ],
);

export const memoryStore = sqliteTable(
  "memory_store",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    confidence: integer("confidence").notNull().default(100),
    source: text("source").notNull().default("explicit"),
    tags: text("tags").notNull().default("[]"),
    epochId: text("epoch_id").references(() => contextEpochs.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: text("last_accessed_at"),
    ttlSeconds: integer("ttl_seconds"),
  },
  (table) => [
    index("idx_memory_type").on(table.type),
    index("idx_memory_key").on(table.key),
    uniqueIndex("idx_memory_type_key").on(table.type, table.key),
    index("idx_memory_session").on(table.sessionId),
  ],
);

export const decisionLog = sqliteTable(
  "decision_log",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    decisionType: text("decision_type").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    confidence: integer("confidence").notNull().default(100),
    memoriesUsed: text("memories_used").notNull().default("[]"),
    memorySnapshot: text("memory_snapshot").notNull().default("[]"),
    epochId: text("epoch_id"),
    proposalId: text("proposal_id"),
    templateId: text("template_id"),
    outcome: text("outcome").notNull().default("pending"),
    outcomeDetail: text("outcome_detail"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_decision_session").on(table.sessionId),
    index("idx_decision_type").on(table.decisionType),
    index("idx_decision_proposal").on(table.proposalId),
    index("idx_decision_outcome").on(table.outcome),
    index("idx_decision_created").on(table.createdAt),
  ],
);

export const modelPerformance = sqliteTable(
  "model_performance",
  {
    id: text("id").primaryKey(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    taskType: text("task_type").notNull(),
    successes: integer("successes").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    avgLatencyMs: integer("avg_latency_ms"),
    totalTokens: integer("total_tokens"),
    totalCostUsd: real("total_cost_usd"),
    totalDecisions: integer("total_decisions").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    uniqueIndex("idx_model_perf_unique").on(table.model, table.provider, table.taskType),
    index("idx_model_perf_task").on(table.taskType),
  ],
);

export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("active"),
    priority: integer("priority").notNull().default(0),
    progressPct: real("progress_pct").notNull().default(0),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
    completedAt: text("completed_at"),
    metadata: text("metadata").notNull().default("{}"),
  },
  (table) => [
    index("idx_goals_status").on(table.status),
    index("idx_goals_priority").on(table.priority),
  ],
);

export const goalPlans = sqliteTable(
  "goal_plans",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("pending"),
    sortOrder: integer("sort_order").notNull().default(0),
    dependencies: text("dependencies").notNull().default("[]"),
    progressPct: real("progress_pct").notNull().default(0),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_goal_plan_goal").on(table.goalId),
    index("idx_goal_plan_status").on(table.status),
    index("idx_goal_plan_sort_order").on(table.sortOrder),
  ],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => goalPlans.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    status: text("status").notNull().default("pending"),
    completedAt: text("completed_at"),
    weight: real("weight").notNull().default(1),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_milestone_plan").on(table.planId),
    index("idx_milestone_status").on(table.status),
  ],
);

export const globalMemory = sqliteTable(
  "global_memory",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    sessionIds: text("session_ids").notNull().default("[]"),
    entities: text("entities").notNull().default("[]"),
    tags: text("tags").notNull().default("[]"),
    importance: real("importance").notNull().default(1.0),
    confidence: integer("confidence").notNull().default(100),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: text("last_accessed_at"),
    embedding: text("embedding"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_global_memory_importance").on(table.importance),
    index("idx_global_memory_confidence").on(table.confidence),
    index("idx_global_memory_created").on(table.createdAt),
    index("idx_global_memory_updated").on(table.updatedAt),
  ],
);

export const memoryEntities = sqliteTable(
  "memory_entities",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id").notNull().references(() => globalMemory.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    type: text("type").notNull().default("concept"),
  },
  (table) => [
    index("idx_mem_entities_memory").on(table.memoryId),
    index("idx_mem_entities_entity").on(table.entity),
  ],
);

export const entityRelations = sqliteTable(
  "entity_relations",
  {
    id: text("id").primaryKey(),
    sourceEntity: text("source_entity").notNull(),
    targetEntity: text("target_entity").notNull(),
    weight: real("weight").notNull().default(1.0),
    relationType: text("relation_type").notNull().default("related"),
    updatedAt: text("updated_at").notNull().default("datetime('now')"),
  },
  (table) => [
    index("idx_entity_rels_source").on(table.sourceEntity),
    index("idx_entity_rels_target").on(table.targetEntity),
    index("idx_entity_rels_type").on(table.relationType),
  ],
);

export const policyChanges = sqliteTable(
  "policy_changes",
  {
    id: text("id").primaryKey(),
    packId: text("pack_id").notNull(),
    status: text("status").notNull().default("draft"),
    statusReason: text("status_reason"),
    originalPackJson: text("original_pack_json").notNull(),
    proposedPackJson: text("proposed_pack_json").notNull(),
    recommendationIds: text("recommendation_ids").notNull().default("[]"),
    createdAt: text("created_at").notNull().default("datetime('now')"),
    approvedAt: text("approved_at"),
    appliedAt: text("applied_at"),
  },
  (table) => [
    index("idx_policy_changes_status").on(table.status),
    index("idx_policy_changes_pack").on(table.packId),
  ],
);
