import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@arely/persistence";
import { pushSchema, connect, close } from "@arely/persistence";

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
