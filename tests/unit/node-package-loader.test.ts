import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { globalNodeRegistry } from "@arely/flow-sdk"
import { createInMemoryDb } from "@arely/engine/persistence/database.js"
import { CREATE_TABLES, CREATE_INDEXES, MIGRATIONS } from "@arely/engine/persistence/migrate.js"
import { NodePackageLoader } from "@arely/engine/compiler/node-package-loader.js"
import {
  listInstalledNodes,
  getInstalledNodeByType,
  getInstalledNode,
} from "@arely/engine/compiler/node-marketplace-store.js"

function writePackage(tmpDir: string, overrides: Record<string, unknown> = {}): string {
  mkdirSync(join(tmpDir, "dist"), { recursive: true })
  const entryPath = join(tmpDir, "dist", "index.js")
  writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    name: "test-pkg",
    version: "1.0.0",
    nodeType: "test-type",
    category: "action",
    description: "Test package",
    author: "Test",
    entry: entryPath,
    ...overrides,
  }))
  writeFileSync(entryPath, `
    const def = {
      type: ${JSON.stringify((overrides.nodeType as string) ?? "test-type")},
      label: "Test Node",
      category: "action",
      inputSchema: {},
      execute: async (ctx, input) => ({ result: "ok", input })
    }
    export default def
  `)
  return entryPath
}

describe("NodePackageLoader", () => {
  let db: ReturnType<typeof createInMemoryDb>
  let loader: NodePackageLoader
  let tmpDir: string

  beforeAll(() => {
    db = createInMemoryDb()
    for (const stmt of CREATE_TABLES) { db.sqlite.exec(stmt) }
    for (const stmt of MIGRATIONS) { try { db.sqlite.exec(stmt) } catch {} }
    for (const idx of CREATE_INDEXES) { try { db.sqlite.exec(idx) } catch {} }
  })

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "np-loader-test-"))
    loader = new NodePackageLoader(db.db)
    // Clean DB and registry state from previous tests
    db.sqlite.exec("DELETE FROM installed_nodes")
    for (const node of globalNodeRegistry.list()) {
      if ((node.type as string) !== "echo") {
        globalNodeRegistry.unregister(node.type)
      }
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads a valid package and registers the node", async () => {
    writePackage(tmpDir)
    const record = await loader.loadPackage(tmpDir)
    expect(record.name).toBe("test-pkg")
    expect(record.nodeType).toBe("test-type")
    expect(record.enabled).toBe(1)
    expect(globalNodeRegistry.has("test-type")).toBe(true)
    // Verify persisted
    const fromDb = getInstalledNodeByType("test-type", db.db)!
    expect(fromDb).toBeDefined()
    expect(fromDb.name).toBe("test-pkg")
  })

  it("throws on missing manifest.json", async () => {
    await expect(loader.loadPackage(tmpDir)).rejects.toThrow("manifest.json not found")
  })

  it("throws on invalid manifest (missing nodeType)", async () => {
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({ name: "x", version: "1.0.0", entry: "/dev/null" }))
    await expect(loader.loadPackage(tmpDir)).rejects.toThrow("nodeType")
  })

  it("throws on unsupported manifestVersion", async () => {
    writePackage(tmpDir, { manifestVersion: 99 })
    await expect(loader.loadPackage(tmpDir)).rejects.toThrow("manifestVersion 99 is not supported")
  })

  it("throws on duplicate nodeType registration", async () => {
    writePackage(tmpDir)
    await loader.loadPackage(tmpDir)
    // Second registration with same type
    const tmpDir2 = mkdtempSync(join(tmpdir(), "np-loader-test-dup-"))
    writePackage(tmpDir2, { name: "test-pkg-2", nodeType: "test-type" })
    await expect(loader.loadPackage(tmpDir2)).rejects.toThrow("Node type already registered")
    rmSync(tmpDir2, { recursive: true, force: true })
  })

  it("throws on duplicate name+version", async () => {
    writePackage(tmpDir)
    await loader.loadPackage(tmpDir)
    const tmpDir2 = mkdtempSync(join(tmpdir(), "np-loader-test-dup2-"))
    writePackage(tmpDir2, { nodeType: "test-type-2" })
    await expect(loader.loadPackage(tmpDir2)).rejects.toThrow("already installed")
    rmSync(tmpDir2, { recursive: true, force: true })
  })

  it("reloadEnabled loads all enabled packages from DB", async () => {
    // Manually install two packages via DB
    mkdirSync(join(tmpDir, "dist"), { recursive: true })
    const entryPath1 = join(tmpDir, "dist", "pkg1.js")
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
      manifestVersion: 1, name: "pkg1", version: "1.0.0", nodeType: "reload-type-1",
      category: "action", entry: entryPath1,
    }))
    writeFileSync(entryPath1, `export default { type: "reload-type-1", label: "R1", category: "action", inputSchema: {}, execute: async () => ({}) }`)

    const pkgDir2 = mkdtempSync(join(tmpdir(), "np-loader-reload-"))
    mkdirSync(join(pkgDir2, "dist"), { recursive: true })
    const entryPath2 = join(pkgDir2, "dist", "pkg2.js")
    writeFileSync(join(pkgDir2, "manifest.json"), JSON.stringify({
      manifestVersion: 1, name: "pkg2", version: "1.0.0", nodeType: "reload-type-2",
      category: "action", entry: entryPath2,
    }))
    writeFileSync(entryPath2, `export default { type: "reload-type-2", label: "R2", category: "action", inputSchema: {}, execute: async () => ({}) }`)

    // Install both via loader
    await loader.loadPackage(tmpDir)
    await loader.loadPackage(pkgDir2)

    // Unregister from registry (simulate restart)
    globalNodeRegistry.unregister("reload-type-1")
    globalNodeRegistry.unregister("reload-type-2")
    expect(globalNodeRegistry.has("reload-type-1")).toBe(false)
    expect(globalNodeRegistry.has("reload-type-2")).toBe(false)

    // Reload from DB
    await loader.reloadEnabled()
    expect(globalNodeRegistry.has("reload-type-1")).toBe(true)
    expect(globalNodeRegistry.has("reload-type-2")).toBe(true)

    rmSync(pkgDir2, { recursive: true, force: true })
  })

  it("reloadEnabled does not load disabled packages", async () => {
    mkdirSync(join(tmpDir, "dist"), { recursive: true })
    const entryPath = join(tmpDir, "dist", "disabled.js")
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
      manifestVersion: 1, name: "disabled-pkg", version: "1.0.0", nodeType: "disabled-type",
      category: "action", entry: entryPath,
    }))
    writeFileSync(entryPath, `export default { type: "disabled-type", label: "D", category: "action", inputSchema: {}, execute: async () => ({}) }`)
    const record = await loader.loadPackage(tmpDir)

    // Disable
    loader.disable(record.id)
    expect(globalNodeRegistry.has("disabled-type")).toBe(false)

    // Reload should not load disabled packages
    const imported = listInstalledNodes(true, db.db)
    const found = imported.find((n) => n.name === "disabled-pkg")
    expect(found).toBeUndefined()
  })

  it("broken package does not block other packages in reloadEnabled", async () => {
    // Install a valid package first
    mkdirSync(join(tmpDir, "dist"), { recursive: true })
    const entry1 = join(tmpDir, "dist", "good.js")
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
      manifestVersion: 1, name: "good-pkg", version: "1.0.0", nodeType: "good-type",
      category: "action", entry: entry1,
    }))
    writeFileSync(entry1, `export default { type: "good-type", label: "G", category: "action", inputSchema: {}, execute: async () => ({}) }`)
    await loader.loadPackage(tmpDir)
    globalNodeRegistry.unregister("good-type")

    // Manually add a second enabled record pointing to a non-existent entry
    const { createInstalledNode } = await import("@arely/engine/compiler/node-marketplace-store.js")
    createInstalledNode({
      name: "broken-pkg", version: "1.0.0", nodeType: "broken-type",
      category: null, description: null, author: null,
      entryPath: join(tmpDir, "nonexistent.js"),
      manifestVersion: 1, enabled: 1,
    }, db.db)

    await loader.reloadEnabled()
    // Good package should still load
    expect(globalNodeRegistry.has("good-type")).toBe(true)
    // Broken package should NOT be loaded
    expect(globalNodeRegistry.has("broken-type")).toBe(false)
  })

  it("disable unregisters and sets enabled=0", async () => {
    writePackage(tmpDir)
    const record = await loader.loadPackage(tmpDir)
    expect(globalNodeRegistry.has("test-type")).toBe(true)

    loader.disable(record.id)
    expect(globalNodeRegistry.has("test-type")).toBe(false)

    const fromDb = getInstalledNode(record.id, db.db)!
    expect(fromDb.enabled).toBe(0)
  })

  it("enable re-registers without reinstalling", async () => {
    writePackage(tmpDir)
    const record = await loader.loadPackage(tmpDir)
    loader.disable(record.id)
    expect(globalNodeRegistry.has("test-type")).toBe(false)

    await loader.enable(record.id)
    expect(globalNodeRegistry.has("test-type")).toBe(true)
    const fromDb = getInstalledNode(record.id, db.db)!
    expect(fromDb.enabled).toBe(1)
  })

  it("remove unregisters and deletes metadata", async () => {
    writePackage(tmpDir)
    const record = await loader.loadPackage(tmpDir)
    expect(globalNodeRegistry.has("test-type")).toBe(true)

    loader.remove(record.id)
    expect(globalNodeRegistry.has("test-type")).toBe(false)
    const fromDb = getInstalledNode(record.id, db.db)
    expect(fromDb).toBeUndefined()
  })
})
