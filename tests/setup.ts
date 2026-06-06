import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@opencode/engine/persistence/schema.js";
import { pushSchema } from "@opencode/engine/persistence/migrate.js";
import { close, connect } from "@opencode/engine/persistence/database.js";

let testDbPath: string | null = null;

export function initTestDb(): void {
  testDbPath = ":memory:";
  pushSchema(testDbPath);
  connect(testDbPath);
}

export function cleanupTestDb(): void {
  close();
  testDbPath = null;
}

export function createStandaloneDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
