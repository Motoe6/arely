import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { UserConfigFile } from "./types.js";

export function getArelyDir(): string {
  return path.join(os.homedir(), ".arely");
}

export function getUserConfigPath(): string {
  return path.join(getArelyDir(), "config.json");
}

export function getDotEnvPath(): string {
  return path.join(getArelyDir(), ".env");
}

export function loadUserConfigFile(): UserConfigFile {
  const configPath = getUserConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8")) as UserConfigFile;
    }
  } catch {
    // ignore corrupt config
  }
  return {};
}

export function saveUserConfigFile(config: UserConfigFile): void {
  const configPath = getUserConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function loadDotEnvFile(): void {
  const envPath = getDotEnvPath();
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && val && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore corrupt .env
  }
}

export function mergeUserConfigIntoEnv(userConfig: UserConfigFile): void {
  if (userConfig.apiKey && !process.env.ARELY_API_KEY) {
    process.env.ARELY_API_KEY = userConfig.apiKey;
  }
  if (userConfig.baseUrl && !process.env.ARELY_BASE_URL) {
    process.env.ARELY_BASE_URL = userConfig.baseUrl;
  }
  if (userConfig.defaultModel) {
    if (!process.env.ARELY_MODEL) process.env.ARELY_MODEL = userConfig.defaultModel;
    if (!process.env.ARELY_DEFAULT_MODEL) process.env.ARELY_DEFAULT_MODEL = userConfig.defaultModel;
  }
  if (userConfig.defaultProvider && !process.env.ARELY_PROVIDER) {
    process.env.ARELY_PROVIDER = userConfig.defaultProvider;
  }
  if (userConfig.port && !process.env.PORT) {
    process.env.PORT = String(userConfig.port);
  }

  // Copy per-provider API keys from config file to env
  if (userConfig.providers) {
    for (const [provider, cfg] of Object.entries(userConfig.providers)) {
      if (!cfg || !cfg.apiKey) continue;
      const envKey = `${provider.toUpperCase()}_API_KEY`;
      if (!process.env[envKey]) {
        process.env[envKey] = cfg.apiKey;
      }
    }
  }
}