import { envSchema } from "./schema.js";
import type { Config } from "./types.js";
import { loadUserConfigFile, loadDotEnvFile, mergeUserConfigIntoEnv } from "./io.js";
export { envSchema } from "./schema.js";
export type { Config, UserConfigFile, KnownProvider, ProviderConfigFile, KNOWN_PROVIDERS } from "./types.js";
export { loadUserConfigFile, saveUserConfigFile, getUserConfigPath, getArelyDir } from "./io.js";

const DEPRECATED_ENV_MAP: Record<string, string> = {
  OPENCODE_API_KEY: "ARELY_API_KEY",
  OPENCODE_BASE_URL: "ARELY_BASE_URL",
  OPENCODE_MODEL: "ARELY_MODEL",
  OPENCODE_WEBSEARCH_PROVIDER: "ARELY_WEBSEARCH_PROVIDER",
  OPENCODE_PERMIT_WEBSEARCH: "ARELY_PERMIT_WEBSEARCH",
  OPENCODE_PERMIT_WEBFETCH: "ARELY_PERMIT_WEBFETCH",
  OPENCODE_MAX_ITERATIONS: "ARELY_MAX_ITERATIONS",
  OPENCODE_STREAMING: "ARELY_STREAMING",
  OPENCODE_TOOL_MODE: "ARELY_TOOL_MODE",
  OPENCODE_AUTO_RECOVER_INTERRUPTED: "ARELY_AUTO_RECOVER_INTERRUPTED",
  OPENCODE_AUTH_HEADER: "ARELY_AUTH_HEADER",
  OPENCODE_AUTH_PREFIX: "ARELY_AUTH_PREFIX",
};

function migrateDeprecatedEnv(): void {
  for (const [oldName, newName] of Object.entries(DEPRECATED_ENV_MAP)) {
    if (process.env[oldName] !== undefined && process.env[newName] === undefined) {
      process.env[newName] = process.env[oldName];
      console.warn(`[DEPRECATED] ${oldName} will be removed in v2.0. Use ${newName} instead.`);
    }
  }
}

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  migrateDeprecatedEnv();

  // Load ~/.arely/.env first (lowest priority, skip in test env)
  if (!process.env.VITEST) {
    loadDotEnvFile();
  }

  // Load ~/.arely/config.json and merge into env (medium priority, skip in test env)
  if (!process.env.VITEST) {
    const userConfig = loadUserConfigFile();
    mergeUserConfigIntoEnv(userConfig);
  }

  // Parse env (highest priority — actual process.env overrides everything)
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