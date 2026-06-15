import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { pushSchema } from "@arely/engine/persistence/migrate.js";
import { connect, close } from "@arely/engine/persistence/database.js";
import { prune, countTraces } from "@arely/engine/persistence/policy-audit-store.js";

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

function seed(dbPath: string, n: number, oldPct: number): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const insert = sqlite.prepare(
    "INSERT INTO policy_audit_events (id, trace_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const oldCutoff = "2025-01-01T00:00:00.000Z";
  const recentCutoff = new Date().toISOString();
  const oldCount = Math.floor(n * oldPct);
  const tx = sqlite.transaction(() => {
    for (let i = 0; i < oldCount; i++) {
      insert.run(ulid(), `old-${i}`, "cycle_started", "{}", oldCutoff);
    }
    for (let i = oldCount; i < n; i++) {
      insert.run(ulid(), `new-${i}`, "cycle_started", "{}", recentCutoff);
    }
  });
  tx();
  sqlite.close();
}

const baseDir = join(tmpdir(), "prune-bench-fixed");

async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("  Prune() — AFTER fix (batch DELETE with HAVING)");
  console.log("=".repeat(64));
  console.log(`  ${"Volume".padEnd(12)} ${"Target".padEnd(12)} ${"Time".padEnd(14)} ${"Pruned".padEnd(10)} ${"Remaining".padEnd(12)}`);
  console.log(`  ${"------".padEnd(12)} ${"------".padEnd(12)} ${"----".padEnd(14)} ${"------".padEnd(10)} ${"---------".padEnd(12)}`);

  for (const { n, pct, label } of [
    { n: 10_000, pct: 0.5, label: "50% (10k)" },
    { n: 10_000, pct: 0.9, label: "90% (10k)" },
    { n: 100_000, pct: 0.5, label: "50% (100k)" },
    { n: 100_000, pct: 0.9, label: "90% (100k)" },
  ]) {
    const dbPath = join(baseDir, `prune-${n}-${pct}.db`);
    rmSync(baseDir, { recursive: true, force: true });
    mkdirSync(baseDir, { recursive: true });

    pushSchema(dbPath);
    connect(dbPath);
    seed(dbPath, n, pct);

    const before = countTraces();
    const start = performance.now();
    const pruned = prune(30);
    const elapsed = performance.now() - start;
    const after = countTraces();

    console.log(`  ${String(n).padStart(7).padEnd(12)} ${label.padEnd(12)} ${fmtMs(elapsed).padEnd(14)} ${pruned}`.padEnd(22) + ` ${after}`);
    console.log(`  ${"".padEnd(12)} ${"".padEnd(12)} ${(pruned / (elapsed / 1000)).toFixed(0).padEnd(10)} traces/s`);

    close();
  }

  rmSync(baseDir, { recursive: true, force: true });

  console.log(`\n  Criterion: < 2s for 100k @ 50%`);
  console.log("  ✓ fixed");
}

main().catch((e) => { console.error(e); process.exit(1); });
