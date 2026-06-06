import { z } from "zod";

const envSchema = z.object({
  OPENCODE_API_KEY: z.string().min(1, "OPENCODE_API_KEY is required"),
  OPENCODE_BASE_URL: z.url().default("https://api.openai.com/v1"),
  OPENCODE_MODEL: z.string().default("gpt-4o"),

  EXA_API_KEY: z.string().optional(),
  PARALLEL_API_KEY: z.string().optional(),
  OPENCODE_WEBSEARCH_PROVIDER: z.enum(["exa", "parallel"]).default("exa"),

  OPENCODE_PERMIT_WEBSEARCH: z.enum(["ask", "allow", "deny"]).default("ask"),
  OPENCODE_PERMIT_WEBFETCH: z.enum(["ask", "allow", "deny"]).default("ask"),

  PORT: z.coerce.number().int().positive().default(8081),
  DB_PATH: z.string().default("./data/opencode.db"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  PERMISSION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

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

  OPENCODE_MAX_ITERATIONS: z.coerce.number().int().positive().default(20),
  OPENCODE_STREAMING: z.coerce.boolean().default(true),
  OPENCODE_TOOL_MODE: z.enum(["native", "text"]).default("native"),

  OPENCODE_AUTO_RECOVER_INTERRUPTED: z.coerce.boolean().default(true),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MAX_TOOL_RESULT_CHARS: z.coerce.number().int().positive().default(4_000),
  LOG_FORMAT: z.enum(["json", "text"]).default("json"),
  DEFAULT_REPLAY_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(1000),
  MAX_REPLAY_BATCH_SIZE: z.coerce.number().int().positive().max(50000).default(5000),

  PLANNING_ENABLED: z.coerce.boolean().default(false),
  PLANNING_MODEL: z.string().optional(),
  PLAN_MAX_STEPS: z.coerce.number().int().positive().max(50).default(10),
  PLAN_PARALLELISM: z.coerce.number().int().positive().max(10).default(3),

  AGENT_RUNTIME_ENABLED: z.coerce.boolean().default(false),
  AGENT_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

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

  HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  HTTP_API_AUTH_ENABLED: z.coerce.boolean().default(false),
  HTTP_CORS_ORIGIN: z.string().default("*"),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  POLICY_PACKS_DIR: z.string().default("./policy-packs"),

  OPENCODE_AUTH_HEADER: z.string().default("Authorization"),
  OPENCODE_AUTH_PREFIX: z.string().default("Bearer"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Configuration validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}
