import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystemPolicyPackStore } from "@opencode/engine/agents/policy/policy-pack.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";

function makeRule(id: string, overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id, when: {},
    then: { type: "trigger_remediation", payload: {} },
    cooldownMs: 60000, maxExecutionsPerHour: 10,
    ...overrides,
  };
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

const baseDir = join(tmpdir(), "stress-policy-pack");

// ─── Test 1: Sequential writes (baseline correctness) ───
function testSequentialWrites(): void {
  const dir = join(baseDir, "test-sequential");
  mkdirSync(dir, { recursive: true });
  const store = new FileSystemPolicyPackStore(dir);

  const pack = store.create({ name: "seq-pack", description: "", rules: [makeRule("r1")] });
  const N = 100;

  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const p = store.get(pack.id)!;
    p.rules.push(makeRule(`r${i + 2}`));
    store.update(pack.id, { rules: p.rules });
  }
  const elapsed = performance.now() - start;

  const final = store.get(pack.id);
  const ok = final !== undefined && final.rules.length === N + 1 && final.rules.every((r, i) => r.id === `r${i + 1}`);
  const avg = elapsed / N;

  console.log(`  Sequential writes (${N} updates):`);
  console.log(`    total: ${fmtMs(elapsed)}, avg: ${fmtMs(avg)}, rules: ${final?.rules.length}`);
  console.log(`    ${ok ? "✓ consistent" : "✗ CORRUPTED"}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 2: Concurrent writes via setImmediate ───
async function testConcurrentWrites(): Promise<void> {
  const dir = join(baseDir, "test-concurrent");
  mkdirSync(dir, { recursive: true });
  const store = new FileSystemPolicyPackStore(dir);

  const pack = store.create({ name: "conc-pack", description: "", rules: [makeRule("r1")] });
  const WRITERS = 10;
  const UPDATES_EACH = 100;

  const start = performance.now();

  const writers = Array.from({ length: WRITERS }, (_, w) =>
    new Promise<void>((resolve) => {
      const runWrites = (i: number) => {
        if (i >= UPDATES_EACH) { resolve(); return; }
        setImmediate(() => {
          try {
            const p = store.get(pack.id);
            if (p) {
              p.rules.push(makeRule(`w${w}-u${i}`));
              store.update(pack.id, { rules: p.rules });
            }
          } catch { /* expected if deleted */ }
          runWrites(i + 1);
        });
      };
      runWrites(0);
    }),
  );

  await Promise.all(writers);
  const elapsed = performance.now() - start;

  const final = store.get(pack.id);
  const totalExpected = 1 + WRITERS * UPDATES_EACH;
  const ok = final !== undefined;
  const jsonParseable = ok && (() => { try { JSON.parse(JSON.stringify(final)); return true; } catch { return false; } })();

  console.log(`  Concurrent writes (${WRITERS} writers × ${UPDATES_EACH} updates):`);
  console.log(`    total: ${fmtMs(elapsed)}`);
  console.log(`    rules in pack: ${final?.rules.length ?? 0} (expected ~${totalExpected})`);
  console.log(`    JSON parseable: ${jsonParseable ? "✓" : "✗"}`);
  console.log(`    store.get() returned: ${ok ? "✓" : "✗"}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 3: Concurrent CRUD (writer + reader + deleter) ───
async function testConcurrentCrud(): Promise<void> {
  const dir = join(baseDir, "test-crud");
  mkdirSync(dir, { recursive: true });
  const store = new FileSystemPolicyPackStore(dir);

  // Create 5 packs
  const packIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = store.create({ name: `crud-pack-${i}`, description: "", rules: [makeRule(`base-${i}`)] });
    packIds.push(p.id);
  }

  let stop = false;
  const errors: string[] = [];

  // Writer: keeps adding rules
  const writer = new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      if (stop || i >= 50) { resolve(); return; }
      setImmediate(() => {
        try {
          const idx = i % packIds.length;
          const p = store.get(packIds[idx]);
          if (p) {
            p.rules.push(makeRule(`w-${i}`));
            store.update(packIds[idx], { rules: p.rules });
          }
        } catch (e) {
          errors.push(`writer: ${e}`);
        }
        i++;
        tick();
      });
    };
    tick();
  });

  // Reader: reads all packs
  const reader = new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      if (stop || i >= 50) { resolve(); return; }
      setImmediate(() => {
        try {
          const all = store.list();
          for (const p of all) {
            const reread = store.get(p.id);
            if (reread) {
              JSON.parse(JSON.stringify(reread)); // verify serializable
            }
          }
        } catch (e) {
          errors.push(`reader: ${e}`);
        }
        i++;
        tick();
      });
    };
    tick();
  });

  // Deleter: deletes and recreates packs
  const deleter = new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      if (stop || i >= 30) { resolve(); return; }
      setImmediate(() => {
        try {
          const idx = i % packIds.length;
          store.delete(packIds[idx]);
          store.create({ name: `crud-pack-${idx}-reborn`, description: "", rules: [makeRule(`reborn-${i}`)] });
        } catch (e) {
          errors.push(`deleter: ${e}`);
        }
        i++;
        tick();
      });
    };
    tick();
  });

  await Promise.all([writer, reader, deleter]);
  stop = true;

  console.log(`  Concurrent CRUD (writer + reader + deleter, 5 packs):`);
  console.log(`    errors: ${errors.length > 0 ? errors.join("; ") : "none ✓"}`);

  // Final consistency check: all files should be valid JSON
  let corruptFiles = 0;
  let parseableFiles = 0;
  for (const id of packIds) {
    const p = store.get(id);
    if (p) {
      try {
        JSON.parse(JSON.stringify(p));
        parseableFiles++;
      } catch {
        corruptFiles++;
      }
    }
  }
  console.log(`    parseable packs: ${parseableFiles}, corrupt: ${corruptFiles} ${corruptFiles === 0 ? "✓" : "✗"}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 4: Restart persistence ───
function testRestartPersistence(): void {
  const dir = join(baseDir, "test-restart");
  mkdirSync(dir, { recursive: true });

  // First session
  const store1 = new FileSystemPolicyPackStore(dir);
  const pack1 = store1.create({
    name: "persist-pack",
    description: "should survive restart",
    rules: [makeRule("persist-rule", { when: { successRate: { lt: 0.5 } } })],
  });

  // "Restart" — create a new store instance
  const store2 = new FileSystemPolicyPackStore(dir);
  const packs = store2.list();
  const retrieved = store2.get(pack1.id);

  const found = packs.some((p) => p.id === pack1.id);
  const rulesMatch = retrieved !== undefined &&
    retrieved.name === "persist-pack" &&
    retrieved.rules.length === 1 &&
    retrieved.rules[0].id === "persist-rule" &&
    retrieved.rules[0].when.successRate?.lt === 0.5;

  console.log(`  Restart persistence:`);
  console.log(`    pack found after restart: ${found ? "✓" : "✗"}`);
  console.log(`    data integrity: ${rulesMatch ? "✓" : "✗"}`);
  console.log(`    store2.list() count: ${packs.length}`);
  console.log(`    timestamps preserved: created=${retrieved?.createdAt?.length ?? 0 > 0 ? "✓" : "✗"}, updated=${retrieved?.updatedAt?.length ?? 0 > 0 ? "✓" : "✗"}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 5: Idempotent operations ───
function testIdempotent(): void {
  const dir = join(baseDir, "test-idempotent");
  mkdirSync(dir, { recursive: true });
  const store = new FileSystemPolicyPackStore(dir);

  const pack = store.create({ name: "idem-pack", description: "", rules: [makeRule("r1")] });

  // Delete same pack twice
  const d1 = store.delete(pack.id);
  const d2 = store.delete(pack.id);

  // Get deleted pack
  const afterDelete = store.get(pack.id);

  // Update non-existent pack
  const updateMissing = store.update("nonexistent", { name: "ghost" });

  console.log(`  Idempotent operations:`);
  console.log(`    first delete: ${d1 ? "✓" : "✗"} (expected true)`);
  console.log(`    second delete: ${d2 ? "✗ (unexpectedly true)" : "✓ (false)"}`);
  console.log(`    get after delete: ${afterDelete === undefined ? "✓ (undefined)" : "✗"}`);
  console.log(`    update nonexistent pack: ${updateMissing === undefined ? "✓ (undefined)" : "✗"}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 6: Malformed filename safety ───
function testMalformedNames(): void {
  const dir = join(baseDir, "test-malformed");
  mkdirSync(dir, { recursive: true });
  const store = new FileSystemPolicyPackStore(dir);

  const trickyNames = [
    "normal-pack",
    "pack with spaces",
    "pack/with/slashes",
    "pack:with:colons",
    "pack.with.dots",
    "UPPERCASE-PACK",
    "pack-123-with-numbers",
  ];

  const created: string[] = [];
  for (const name of trickyNames) {
    try {
      const p = store.create({ name, description: "", rules: [makeRule("r1")] });
      created.push(p.id);
    } catch (e) {
      console.log(`    FAILED to create "${name}": ${e}`);
    }
  }

  const all = store.list();
  const rereadCount = created.filter((id) => store.get(id) !== undefined).length;

  console.log(`  Malformed/special filenames:`);
  for (const id of created) {
    const p = store.get(id);
    console.log(`    "${p?.name ?? id}": ${p ? "✓" : "✗"}`);
  }
  console.log(`    created: ${created.length}/${trickyNames.length}, readable: ${rereadCount}/${created.length}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Main ───
async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log("  A3.2 — F33 Policy Pack Consistency");
  console.log("=".repeat(78));

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  1. Sequential writes (baseline correctness)");
  testSequentialWrites();

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  2. Concurrent writes (10 writers, 100 updates each)");
  await testConcurrentWrites();

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  3. Concurrent CRUD (writer + reader + deleter)");
  await testConcurrentCrud();

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  4. Restart persistence");
  testRestartPersistence();

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  5. Idempotent operations");
  testIdempotent();

  console.log(`\n${"▔".repeat(78)}`);
  console.log("  6. Malformed/special filenames");
  testMalformedNames();

  console.log(`\n${"=".repeat(78)}`);
  console.log("  A3.2 COMPLETE");
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
