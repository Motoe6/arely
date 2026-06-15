import type { z } from "zod";
import type { envSchema } from "./schema.js";

export type Config = z.infer<typeof envSchema>;

export interface UserConfigFile {
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
  mode?: "chat" | "agent" | "server";
  baseUrl?: string;
  port?: number;
  swarmEnabled?: boolean;
  goalResumeEnabled?: boolean;
  benchmarksEnabled?: boolean;
  autoRecover?: boolean;
  apiKey?: string;
}
