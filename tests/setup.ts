import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/persistence/schema.js";
import { pushSchema } from "../src/persistence/migrate.js";
import { close, connect } from "../src/persistence/database.js";

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
