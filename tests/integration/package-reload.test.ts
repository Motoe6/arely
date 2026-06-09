import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { TemplateRegistry } from "@opencode/engine/templates/template-registry.js"
import { NodePackageLoader } from "@opencode/engine/compiler/node-package-loader.js"
import { globalNodeRegistry, HttpNode, LLMNode } from "@opencode/flow-sdk"
import { loadConfig } from "@opencode/engine/config/index.js"
import { connect, close, createInMemoryDb } from "@opencode/engine/persistence/database.js"
import { pushSchema } from "@opencode/engine/persistence/migrate.js"
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { listInstalledPackages } from "@opencode/engine/compiler/package-store.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MANIFEST = {
  manifestVersion: 2,
  name: "test-pkg",
  version: "1.0.0",
  description: "Test package for reload roundtrip",
  author: "Test",
  nodes: [],
  templates: [
    { id: "pkg-template", path: "./template" },
  ],
}

const TEMPLATE_META = {
  id: "pkg-template",
  name: "Package Template",
  description: "Template from package",
  category: "test",
  tags: ["pkg"],
  templateVersion: "1.0.0",
  author: "Test",
  parameters: [],
  requires: ["http"],
}

const TEMPLATE_YAML = `name: pkg-template
description: Template from package
steps:
  - id: step1
    type: http
    input:
      url: https://example.com
`

describe("Package Reload Roundtrip", () => {
  let tmpDir: string

  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key"
    loadConfig()
    connect(":memory:")

    try { globalNodeRegistry.register(HttpNode) } catch { /* ok */ }
    try { globalNodeRegistry.register(LLMNode) } catch { /* ok */ }

    tmpDir = mkdtempSync(join(tmpdir(), "pkg-reload-test-"))
    const pkgDir = join(tmpDir, "packages", "test-pkg")
    const tmplDir = join(pkgDir, "template")
    mkdirSync(tmplDir, { recursive: true })
    writeFileSync(join(pkgDir, "manifest.json"), JSON.stringify(MANIFEST, null, 2))
    writeFileSync(join(tmplDir, "metadata.json"), JSON.stringify(TEMPLATE_META, null, 2))
    writeFileSync(join(tmplDir, "template.yaml"), TEMPLATE_YAML)
  })

  afterAll(() => {
    try { globalNodeRegistry.unregister("http") } catch { /* ok */ }
    try { globalNodeRegistry.unregister("llm") } catch { /* ok */ }
    rmSync(tmpDir, { recursive: true, force: true })
    close()
  })

  it("installs package, then reloads into fresh registry and can recommend", async () => {
    const pkgDir = join(tmpDir, "packages", "test-pkg")

    // First engine instance
    const registry1 = new TemplateRegistry()
    const loader1 = new NodePackageLoader()
    loader1.setTemplateRegistry(registry1)

    const pkgId = await loader1.loadPackageV2(pkgDir)
    expect(pkgId).toBeTruthy()

    // Verify template is in registry1
    const tmpl1 = registry1.get("pkg-template")
    expect(tmpl1).toBeTruthy()
    expect(tmpl1?.metadata.source).toBe("package")

    // Verify package is persisted
    const records = listInstalledPackages()
    expect(records.length).toBe(1)
    expect(records[0].name).toBe("test-pkg")
    expect(records[0].version).toBe("1.0.0")

    // Simulate restart: discard registry1 + loader1, create fresh
    const registry2 = new TemplateRegistry()
    const loader2 = new NodePackageLoader()
    loader2.setTemplateRegistry(registry2)

    // Verify registry2 is empty
    expect(registry2.get("pkg-template")).toBeUndefined()

    // Reload packages from DB
    loader2.reloadPackages()

    // Verify template is in registry2
    const tmpl2 = registry2.get("pkg-template")
    expect(tmpl2).toBeTruthy()
    expect(tmpl2?.metadata.source).toBe("package")
    expect(tmpl2?.metadata.id).toBe("pkg-template")
  })
})
