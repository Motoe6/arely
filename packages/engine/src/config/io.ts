import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { UserConfigFile } from "./types.js";

export function getUserConfigPath(): string {
  return path.join(os.homedir(), ".arely", "config.json");
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
