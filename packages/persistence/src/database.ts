import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "./migrate.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function connect(databasePath?: string) {
  if (_db) return _db;

  const path = databasePath ?? process.env.DB_PATH ?? "./data/arely.db";
  _sqlite = new Database(path);

  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("busy_timeout = 5000");
  _sqlite.pragma("synchronous = NORMAL");
  _sqlite.pragma("foreign_keys = ON");

  for (const stmt of CREATE_TABLES) {
    _sqlite.exec(stmt);
  }
  for (const stmt of MIGRATIONS) {
    try { _sqlite.exec(stmt); } catch { /* may already exist */ }
  }
  for (const idx of CREATE_INDEXES) {
    _sqlite.exec(idx);
  }

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getDb() {
  if (!_db) throw new Error("Database not connected. Call connect() first.");
  return _db;
}

export function close() {
  _sqlite?.close();
  _db = null;
  _sqlite = null;
}

export function createInMemoryDb(): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: DatabaseType;
  close: () => void;
} {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}
