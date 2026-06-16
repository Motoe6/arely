import { z } from "zod";

export const llmSchema = z.object({
  ARELY_API_KEY: z.string().optional(),
  ARELY_BASE_URL: z.string().default("https://api.openai.com/v1"),
  ARELY_MODEL: z.string().default("gpt-4o"),
  ARELY_PROVIDER: z.enum(["openai", "anthropic", "ollama", "lmstudio", "local"]).default("openai"),
  ARELY_MAX_ITERATIONS: z.coerce.number().int().positive().default(20),
  ARELY_STREAMING: z.coerce.boolean().default(true),
  ARELY_TOOL_MODE: z.enum(["native", "text"]).default("native"),
  ARELY_AUTO_RECOVER_INTERRUPTED: z.coerce.boolean().default(true),
  ARELY_MODELS: z.string().optional(),
  ARELY_DEFAULT_MODEL: z.string().default("deepseek-v4"),
  ARELY_AUTH_HEADER: z.string().default("Authorization"),
  ARELY_AUTH_PREFIX: z.string().default("Bearer"),

  // Multi-provider API keys (env overrides config file)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  LMSTUDIO_BASE_URL: z.string().default("http://localhost:1234/v1"),
});

export const toolsSchema = z.object({
  EXA_API_KEY: z.string().optional(),
  PARALLEL_API_KEY: z.string().optional(),
  ARELY_WEBSEARCH_PROVIDER: z.enum(["exa", "parallel"]).default("exa"),
  ARELY_PERMIT_WEBSEARCH: z.enum(["ask", "allow", "deny"]).default("ask"),
  ARELY_PERMIT_WEBFETCH: z.enum(["ask", "allow", "deny"]).default("ask"),
  TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MAX_TOOL_RESULT_CHARS: z.coerce.number().int().positive().default(4_000),
  CIRCUIT_BREAKER_ENABLED: z.coerce.boolean().default(true),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30_000),
  RETRY_ENABLED: z.coerce.boolean().default(true),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1_000),
  RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(30_000),
  RATE_LIMIT_ENABLED: z.coerce.boolean().default(false),
  RATE_LIMIT_DEFAULT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_DEFAULT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export const serverSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8081),
  DB_PATH: z.string().default("./data/arely.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["json", "text"]).default("json"),
  PERMISSION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  HTTP_API_AUTH_ENABLED: z.coerce.boolean().default(false),
  HTTP_CORS_ORIGIN: z.string().default("*"),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  DEFAULT_REPLAY_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(1000),
  MAX_REPLAY_BATCH_SIZE: z.coerce.number().int().positive().max(50000).default(5000),
});

export const planningSchema = z.object({
  PLANNING_ENABLED: z.coerce.boolean().default(false),
  PLANNING_MODEL: z.string().optional(),
  PLAN_MAX_STEPS: z.coerce.number().int().positive().max(50).default(10),
  PLAN_PARALLELISM: z.coerce.number().int().positive().max(10).default(3),
});

export const agentSchema = z.object({
  AGENT_RUNTIME_ENABLED: z.coerce.boolean().default(false),
  AGENT_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
});

export const notificationSchema = z.object({
  NOTIFY_SLACK_WEBHOOK_URL: z.string().optional(),
  NOTIFY_DISCORD_WEBHOOK_URL: z.string().optional(),
  NOTIFY_EMAIL_HOST: z.string().optional(),
  NOTIFY_EMAIL_PORT: z.coerce.number().int().positive().optional(),
  NOTIFY_EMAIL_SECURE: z.coerce.boolean().optional(),
  NOTIFY_EMAIL_AUTH_USER: z.string().optional(),
  NOTIFY_EMAIL_AUTH_PASS: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().optional(),
  NOTIFY_EMAIL_TO: z.string().optional(),
  NOTIFY_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  NOTIFY_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(5_000),
  NOTIFY_QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  NOTIFY_IDEMPOTENCY_WINDOW_S: z.coerce.number().int().positive().default(300),
});

export const pathsSchema = z.object({
  POLICY_PACKS_DIR: z.string().default("./policy-packs"),
  USER_TEMPLATES_DIR: z.string().default("./data/user_templates"),
  PACKAGES_DIR: z.string().default("./data/packages"),
});

export const envSchema = z.object({})
  .merge(llmSchema)
  .merge(toolsSchema)
  .merge(serverSchema)
  .merge(planningSchema)
  .merge(agentSchema)
  .merge(notificationSchema)
  .merge(pathsSchema);
