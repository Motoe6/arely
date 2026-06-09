import Database from "better-sqlite3";

export const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'idle',
    query TEXT NOT NULL,
    model TEXT NOT NULL,
    tool_mode TEXT NOT NULL DEFAULT 'native',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_ms INTEGER,
    provider TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'ask',
    permission_granted INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS permission_approvals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    mode TEXT NOT NULL,
    granted INTEGER NOT NULL,
    responded_at TEXT NOT NULL DEFAULT (datetime('now')),
    response_time_ms INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS approval_cache (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    args_pattern TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    correlation_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    target TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS plan_steps (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    tool TEXT,
    args TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    "order" INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS agent_memory (
    agent_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pipeline_steps (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES agent_pipelines(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'agent',
    agent_id TEXT REFERENCES agents(id),
    tool_name TEXT,
    step_order INTEGER NOT NULL,
    depends_on TEXT NOT NULL DEFAULT '[]',
    input_mapping TEXT,
    output_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES agent_pipelines(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    steps_total INTEGER NOT NULL DEFAULT 0,
    steps_completed INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pipeline_step_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    step_type TEXT NOT NULL,
    agent_id TEXT,
    tool_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT,
    finished_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    trigger_input TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    duration_ms INTEGER,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_step_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    input TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    duration_ms INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS notification_queue (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    alert_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL REFERENCES notification_queue(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS policy_audit_events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    goal TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'planning',
    trigger TEXT NOT NULL DEFAULT 'manual',
    trigger_config TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    current_version_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_versions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    workflow_dsl TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS policy_changes (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    status_reason TEXT,
    original_pack_json TEXT NOT NULL,
    proposed_pack_json TEXT NOT NULL,
    recommendation_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT,
    applied_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_triggers (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    trigger_mode TEXT NOT NULL,
    cron_expression TEXT,
    interval_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT NOT NULL,
    last_run_at TEXT,
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS installed_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    author TEXT,
    package_dir TEXT NOT NULL,
    manifest_version INTEGER NOT NULL DEFAULT 2,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS installed_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    node_type TEXT NOT NULL UNIQUE,
    category TEXT,
    description TEXT,
    author TEXT,
    entry_path TEXT NOT NULL,
    manifest_version INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    value_encrypted TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

export const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_perm_approvals_session ON permission_approvals(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_approval_cache_session ON approval_cache(session_id, tool_name)",
  "CREATE INDEX IF NOT EXISTS idx_approval_cache_forever ON approval_cache(tool_name)",
  "CREATE INDEX IF NOT EXISTS idx_event_log_session ON event_log(session_id, id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category)",
  "CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id)",
  "CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status)",
  "CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id)",
  "CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(enabled)",
  "CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id)",
  "CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id)",
  "CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id)",
  "CREATE INDEX IF NOT EXISTS idx_pipeline_step_runs_run ON pipeline_step_runs(run_id)",
  "CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status)",
  "CREATE INDEX IF NOT EXISTS idx_notification_queue_next_retry ON notification_queue(next_retry_at)",
  "CREATE INDEX IF NOT EXISTS idx_notification_queue_idempotency ON notification_queue(idempotency_key)",
  "CREATE INDEX IF NOT EXISTS idx_notification_events_notification ON notification_events(notification_id)",
  "CREATE INDEX IF NOT EXISTS idx_policy_audit_trace ON policy_audit_events(trace_id)",
  "CREATE INDEX IF NOT EXISTS idx_policy_audit_type ON policy_audit_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_policy_audit_created ON policy_audit_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_policy_changes_status ON policy_changes(status)",
  "CREATE INDEX IF NOT EXISTS idx_policy_changes_pack ON policy_changes(pack_id)",
  "CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_wf_versions_workflow ON workflow_versions(workflow_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_versions_unique ON workflow_versions(workflow_id, version)",
  "CREATE INDEX IF NOT EXISTS idx_wf_runs_workflow ON workflow_runs(workflow_id)",
  "CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON workflow_runs(status)",
  "CREATE INDEX IF NOT EXISTS idx_wf_runs_started ON workflow_runs(started_at)",
  "CREATE INDEX IF NOT EXISTS idx_wf_step_runs_run ON workflow_step_runs(run_id)",
  "CREATE INDEX IF NOT EXISTS idx_wf_step_runs_copied ON workflow_step_runs(copied_from_step_run_id)",
  "CREATE INDEX IF NOT EXISTS idx_wf_runs_replay_of ON workflow_runs(replay_of_run_id)",
  "CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_workflow ON scheduled_triggers(workflow_id)",
  "CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_next_run ON scheduled_triggers(next_run_at)",
  "CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_enabled_next ON scheduled_triggers(enabled, next_run_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_packages_name_version ON installed_packages(name, version)",
  "CREATE INDEX IF NOT EXISTS idx_installed_packages_enabled ON installed_packages(enabled)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_nodes_name_version ON installed_nodes(name, version)",
  "CREATE INDEX IF NOT EXISTS idx_installed_nodes_type ON installed_nodes(node_type)",
  "CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name)",
];

export const MIGRATIONS = [
  "ALTER TABLE plans ADD COLUMN agent_id TEXT",
  "ALTER TABLE pipeline_steps ADD COLUMN type TEXT NOT NULL DEFAULT 'agent'",
  "ALTER TABLE pipeline_steps ADD COLUMN tool_name TEXT",
  "ALTER TABLE pipeline_runs ADD COLUMN steps_total INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE pipeline_runs ADD COLUMN steps_completed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE pipeline_runs ADD COLUMN replay_of TEXT",
  "ALTER TABLE pipeline_step_runs ADD COLUMN tool_input_hash TEXT",
  "ALTER TABLE pipeline_step_runs ADD COLUMN tool_output_hash TEXT",
  "ALTER TABLE pipeline_step_runs ADD COLUMN error_kind TEXT",
  "ALTER TABLE pipeline_steps ADD COLUMN timeout_ms INTEGER",
  "ALTER TABLE pipeline_steps ADD COLUMN retries INTEGER",
  "ALTER TABLE pipeline_steps ADD COLUMN retry_delay_ms INTEGER",
  "ALTER TABLE pipeline_steps ADD COLUMN idempotent INTEGER",
  "ALTER TABLE pipeline_steps ADD COLUMN retryable_errors TEXT",
  "ALTER TABLE pipeline_steps ADD COLUMN retry_strategy TEXT",
  "ALTER TABLE workflow_runs ADD COLUMN replay_of_run_id TEXT",
  "ALTER TABLE workflow_runs ADD COLUMN replay_from_step_id TEXT",
  "ALTER TABLE workflow_step_runs ADD COLUMN copied_from_step_run_id TEXT",
];

export function pushSchema(databasePath?: string): void {
  const path = databasePath ?? process.env.DB_PATH ?? "./data/opencode.db";
  const sqlite = new Database(path);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const stmt of CREATE_TABLES) {
      sqlite.exec(stmt);
    }
    for (const stmt of MIGRATIONS) {
      try { sqlite.exec(stmt); } catch { /* may already exist */ }
    }
    for (const idx of CREATE_INDEXES) {
      sqlite.exec(idx);
    }
  } finally {
    sqlite.close();
  }
}
