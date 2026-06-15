import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface UserConfig {
  defaultProvider: string;
  defaultModel: string;
  enabledModels: string[];
  mode: "chat" | "agent" | "server";
}

const CONFIG_DIR = path.join(os.homedir(), ".arely");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

const DEFAULTS: UserConfig = {
  defaultProvider: "ollama",
  defaultModel: "",
  enabledModels: [],
  mode: "chat",
};

export function loadUserConfig(): UserConfig {
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUserConfig(config: UserConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function setDefaultModel(model: string, provider?: string): void {
  const cfg = loadUserConfig();
  cfg.defaultModel = model;
  if (provider) cfg.defaultProvider = provider;
  if (!cfg.enabledModels.includes(model)) {
    cfg.enabledModels.push(model);
  }
  saveUserConfig(cfg);
}

export function toggleModel(model: string, enabled: boolean): void {
  const cfg = loadUserConfig();
  if (enabled && !cfg.enabledModels.includes(model)) {
    cfg.enabledModels.push(model);
  } else if (!enabled) {
    cfg.enabledModels = cfg.enabledModels.filter((m) => m !== model);
    if (cfg.defaultModel === model) {
      cfg.defaultModel = cfg.enabledModels[0] ?? "";
    }
  }
  saveUserConfig(cfg);
}

export function setMode(mode: UserConfig["mode"]): void {
  const cfg = loadUserConfig();
  cfg.mode = mode;
  saveUserConfig(cfg);
}
