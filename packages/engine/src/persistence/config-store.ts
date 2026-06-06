import { eq } from "drizzle-orm";
import { getDb } from "./database.js";
import { config } from "./schema.js";
import type { ConfigEntry } from "../types.js";

export function getConfigValue(key: string): string | undefined {
  const row = getDb()
    .select()
    .from(config)
    .where(eq(config.key, key))
    .get();
  return row?.value;
}

export function setConfigValue(key: string, value: string): void {
  getDb()
    .insert(config)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: config.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

export function getAllConfig(): ConfigEntry[] {
  return getDb().select().from(config).all();
}

export function deleteConfig(key: string): void {
  getDb().delete(config).where(eq(config.key, key)).run();
}
