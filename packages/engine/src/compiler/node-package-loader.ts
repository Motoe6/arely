/**
 * WARNING: Installing a node package grants arbitrary code execution
 * with the same permissions as the engine process. No sandboxing or
 * isolation is provided in this version. Only install packages from
 * trusted sources.
 */
import { readFileSync, existsSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { globalNodeRegistry } from "@arelyos/flow-sdk"
import type { NodeDefinition } from "@arelyos/flow-sdk"
import type { InstalledNodeRecord } from "./node-marketplace-store.js"
import {
  createInstalledPackage,
  getInstalledPackage,
  getInstalledPackageByNameVersion,
  listInstalledPackages,
  deleteInstalledPackage,
} from "./package-store.js"
import {
  createInstalledNode,
  getInstalledNode,
  getInstalledNodeByType,
  getInstalledNodeByNameVersion,
  listInstalledNodes,
  updateInstalledNode,
  deleteInstalledNode,
} from "./node-marketplace-store.js"
import { listWorkflows, getWorkflowWithCurrentVersion } from "../persistence/workflow-store.js"
import type { TemplateSource } from "../templates/template-types.js"

const SUPPORTED_MANIFEST_VERSION = 2

type DbClient = any

interface PackageManifestV1 {
  manifestVersion: number
  name: string
  version: string
  nodeType: string
  entry: string
  category?: string
  description?: string
  author?: string
}

interface PackageManifestV2Node {
  type: string
  entry: string
  category?: string
  description?: string
}

interface PackageManifestV2Template {
  id: string
  path: string
}

interface PackageManifestV2 {
  manifestVersion: number
  name: string
  version: string
  description?: string
  author?: string
  nodes?: PackageManifestV2Node[]
  templates?: PackageManifestV2Template[]
}

export class NodePackageLoader {
  private db?: DbClient
  private templateRegistry?: { registerTemplate: (dir: string, source?: TemplateSource) => void; unregisterTemplate?: (id: string) => boolean; get?: (id: string) => unknown; list?: () => { id: string }[] }

  constructor(db?: DbClient) {
    this.db = db
  }

  setTemplateRegistry(tr: { registerTemplate: (dir: string, source?: TemplateSource) => void; unregisterTemplate?: (id: string) => boolean; get?: (id: string) => unknown; list?: () => { id: string }[] }): void {
    this.templateRegistry = tr
  }

  async loadPackage(packageDir: string): Promise<InstalledNodeRecord> {
    const manifestPath = join(packageDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${packageDir}`)
    }

    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(readFileSync(manifestPath, "utf-8"))
    } catch {
      throw new Error(`Invalid JSON in manifest.json at ${manifestPath}`)
    }

    const manifest = validateManifest(manifestRaw)
    const entryPath = isAbsolute(manifest.entry) ? manifest.entry : join(packageDir, manifest.entry)

    if (!existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${entryPath}`)
    }

    const nodeDef = await importNodeDefinition(entryPath)

    if (this.registry.has(manifest.nodeType)) {
      throw new Error(`Node type already registered: ${manifest.nodeType}`)
    }

    const existing = getInstalledNodeByNameVersion(manifest.name, manifest.version, this.db)
    if (existing) {
      throw new Error(`Package "${manifest.name}@${manifest.version}" is already installed (id: ${existing.id})`)
    }

    this.registry.register(nodeDef)

    try {
      const record = createInstalledNode({
        name: manifest.name,
        version: manifest.version,
        nodeType: manifest.nodeType,
        category: manifest.category ?? null,
        description: manifest.description ?? null,
        author: manifest.author ?? null,
        entryPath,
        manifestVersion: manifest.manifestVersion,
        enabled: 1 as const,
      }, this.db)
      return record
    } catch (err) {
      this.registry.unregister(manifest.nodeType)
      throw err
    }
  }

  async reloadEnabled(): Promise<void> {
    const records = listInstalledNodes(true, this.db)
    for (const record of records) {
      try {
        await this.loadSinglePackage(record)
      } catch (err) {
        console.warn(`[node-package-loader] Failed to load package "${record.name}@${record.version}": ${err}`)
      }
    }
  }

  disable(id: string): void {
    const record = getInstalledNode(id, this.db)
    if (!record) throw new Error(`Installed node not found: ${id}`)
    this.registry.unregister(record.nodeType)
    updateInstalledNode(id, { enabled: 0 } as Partial<InstalledNodeRecord>, this.db)
  }

  async enable(id: string): Promise<void> {
    const record = getInstalledNode(id, this.db)
    if (!record) throw new Error(`Installed node not found: ${id}`)
    if (this.registry.has(record.nodeType)) {
      throw new Error(`Node type "${record.nodeType}" conflicts with an already registered node`)
    }

    const mod = await importNodeDefinition(record.entryPath)
    this.registry.register(mod)
    updateInstalledNode(id, { enabled: 1 } as Partial<InstalledNodeRecord>, this.db)
  }

  remove(id: string): void {
    const record = getInstalledNode(id, this.db)
    if (!record) throw new Error(`Installed node not found: ${id}`)
    this.registry.unregister(record.nodeType)
    deleteInstalledNode(id, this.db)
  }

  async loadPackageV2(
    packageDir: string,
    opts?: {
      onTemplateError?: (templateId: string, err: Error) => void
      onNodeError?: (nodeType: string, err: Error) => void
    },
  ): Promise<string> {
    const manifestPath = join(packageDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${packageDir}`)
    }

    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(readFileSync(manifestPath, "utf-8"))
    } catch {
      throw new Error(`Invalid JSON in manifest.json at ${manifestPath}`)
    }

    const manifest = validateManifestV2(manifestRaw)
    const { name, version } = manifest

    const existing = getInstalledPackageByNameVersion(name, version, this.db)
    if (existing) {
      throw new Error(`Package "${name}@${version}" is already installed`)
    }

    const registeredNodeTypes: string[] = []
    const registeredTemplateIds: string[] = []

    try {
      if (manifest.nodes) {
        for (const node of manifest.nodes) {
          const entryPath = isAbsolute(node.entry) ? node.entry : join(packageDir, node.entry)
          if (!existsSync(entryPath)) {
            throw new Error(`Entry file not found: ${entryPath}`)
          }
          if (this.registry.has(node.type)) {
            throw new Error(`Node type already registered: ${node.type}`)
          }
          const nodeDef = await importNodeDefinition(entryPath)
          this.registry.register(nodeDef)
          registeredNodeTypes.push(node.type)

          createInstalledNode({
            name,
            version,
            nodeType: node.type,
            category: node.category ?? null,
            description: node.description ?? null,
            author: manifest.author ?? null,
            entryPath,
            manifestVersion: 2,
            enabled: 1 as const,
          }, this.db)
        }
      }

      if (manifest.templates && this.templateRegistry) {
        for (const tmpl of manifest.templates) {
          if (this.templateRegistry.get?.(tmpl.id)) {
            throw new Error(`Template ID "${tmpl.id}" already exists in the registry (conflict with built-in, user, or another package template)`)
          }
        }
        for (const tmpl of manifest.templates) {
          const templateDir = isAbsolute(tmpl.path) ? tmpl.path : join(packageDir, tmpl.path)
          if (!existsSync(templateDir)) {
            const err = new Error(`Template directory not found: ${templateDir}`)
            if (opts?.onTemplateError) {
              opts.onTemplateError(tmpl.id, err)
              continue
            }
            throw err
          }
          try {
            this.templateRegistry.registerTemplate(templateDir, "package")
            registeredTemplateIds.push(tmpl.id)
          } catch (err) {
            if (opts?.onTemplateError) {
              opts.onTemplateError(tmpl.id, err instanceof Error ? err : new Error(String(err)))
            } else {
              throw err
            }
          }
        }
      }

      const record = createInstalledPackage({
        name,
        version,
        description: manifest.description ?? null,
        author: manifest.author ?? null,
        packageDir,
        manifestVersion: 2,
        enabled: 1 as const,
      }, this.db)

      return record.id
    } catch (err) {
      for (const nodeType of registeredNodeTypes) {
        this.registry.unregister(nodeType)
        deleteInstalledNode(nodeType, this.db)
      }
      for (const tid of registeredTemplateIds) {
        this.templateRegistry?.unregisterTemplate?.(tid)
      }
      throw err
    }
  }

  removePackage(id: string): void {
    const record = getInstalledPackage(id, this.db)
    if (!record) throw new Error(`Installed package not found: ${id}`)

    const nodes = listInstalledNodes(false, this.db)
    const pkgNodes = nodes.filter((n) => n.name === record.name && n.version === record.version)

    const packageNodeTypes = new Set(pkgNodes.map((n) => n.nodeType))
    if (packageNodeTypes.size > 0) {
      const workflows = listWorkflows(this.db)
      for (const wf of workflows) {
        if (!wf.currentVersionId) continue
        const entry = getWorkflowWithCurrentVersion(wf.id, this.db)
        if (!entry?.version) continue
        let parsed: { steps?: { type: string }[] }
        try {
          parsed = JSON.parse(entry.version.workflowDsl) as { steps?: { type: string }[] }
        } catch {
          continue
        }
        const steps = parsed.steps ?? []
        for (const step of steps) {
          if (packageNodeTypes.has(step.type)) {
            throw new Error(
              `Cannot uninstall package "${record.name}@${record.version}": workflow "${wf.id}" uses node type "${step.type}"`,
            )
          }
        }
      }
    }

    for (const node of pkgNodes) {
      this.registry.unregister(node.nodeType)
      deleteInstalledNode(node.id, this.db)
    }

    if (this.templateRegistry) {
      const templates = this.templateRegistry.list?.() ?? []
      for (const t of templates) {
        if (t.id.startsWith(record.name.replace(/\s+/g, "_"))) {
          this.templateRegistry.unregisterTemplate?.(t.id)
        }
      }
    }

    deleteInstalledPackage(id, this.db)
  }

  reloadPackages(): void {
    const records = listInstalledPackages(true, this.db)
    for (const record of records) {
      try {
        const manifest = this.readManifestV2(record.packageDir)
        if (!manifest) continue
        this.registerPackageComponents(record.packageDir, manifest, true, {
          onNodeError: (nodeType, err) => {
            console.warn(`[node-package-loader] Failed to load node "${nodeType}" from package "${record.name}@${record.version}": ${err}`)
          },
          onTemplateError: (templateId, err) => {
            console.warn(`[node-package-loader] Failed to load template "${templateId}" from package "${record.name}@${record.version}": ${err}`)
          },
        })
      } catch (err) {
        console.warn(`[node-package-loader] Failed to reload package "${record.name}@${record.version}": ${err}`)
      }
    }
  }

  private readManifestV2(packageDir: string): PackageManifestV2 | null {
    const manifestPath = join(packageDir, "manifest.json")
    if (!existsSync(manifestPath)) return null
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8"))
    return validateManifestV2(raw)
  }

  private registerPackageComponents(
    packageDir: string,
    manifest: PackageManifestV2,
    skipNodeImport: boolean,
    opts?: {
      onTemplateError?: (templateId: string, err: Error) => void
      onNodeError?: (nodeType: string, err: Error) => void
    },
  ): void {
    if (manifest.templates && this.templateRegistry) {
      for (const tmpl of manifest.templates) {
        if (this.templateRegistry.get?.(tmpl.id)) {
          if (opts?.onTemplateError) {
            opts.onTemplateError(tmpl.id, new Error(`Template ID "${tmpl.id}" already exists in registry`))
          }
          continue
        }
        const templateDir = isAbsolute(tmpl.path) ? tmpl.path : join(packageDir, tmpl.path)
        if (!existsSync(templateDir)) {
          const err = new Error(`Template directory not found: ${templateDir}`)
          if (opts?.onTemplateError) {
            opts.onTemplateError(tmpl.id, err)
          }
          continue
        }
        try {
          this.templateRegistry.registerTemplate(templateDir, "package")
        } catch (err) {
          if (opts?.onTemplateError) {
            opts.onTemplateError(tmpl.id, err instanceof Error ? err : new Error(String(err)))
          }
        }
      }
    }
  }

  private async loadSinglePackage(record: InstalledNodeRecord): Promise<void> {
    const mod = await importNodeDefinition(record.entryPath)
    this.registry.register(mod)
  }

  private get registry() {
    return globalNodeRegistry
  }
}

function validateManifestV2(raw: unknown): PackageManifestV2 {
  if (!raw || typeof raw !== "object") {
    throw new Error("manifest.json must be a JSON object")
  }
  const m = raw as Record<string, unknown>

  const manifestVersion = m.manifestVersion !== undefined ? Number(m.manifestVersion) : 2
  if (!Number.isInteger(manifestVersion) || manifestVersion < 1) {
    throw new Error("manifestVersion must be a positive integer")
  }
  if (manifestVersion > SUPPORTED_MANIFEST_VERSION) {
    throw new Error(`manifestVersion ${manifestVersion} is not supported (max: ${SUPPORTED_MANIFEST_VERSION})`)
  }
  if (manifestVersion < 2) {
    throw new Error("manifestVersion 2 is required for package loading")
  }

  if (!m.name || typeof m.name !== "string") {
    throw new Error("manifest.json: 'name' is required and must be a string")
  }
  if (!m.version || typeof m.version !== "string") {
    throw new Error("manifest.json: 'version' is required and must be a string")
  }

  let nodes: PackageManifestV2Node[] | undefined
  if (m.nodes !== undefined) {
    if (!Array.isArray(m.nodes)) {
      throw new Error("manifest.json: 'nodes' must be an array")
    }
    nodes = m.nodes.map((n: unknown, i: number) => {
      if (!n || typeof n !== "object") {
        throw new Error(`manifest.json: nodes[${i}] must be an object`)
      }
      const node = n as Record<string, unknown>
      if (!node.type || typeof node.type !== "string") {
        throw new Error(`manifest.json: nodes[${i}].type is required and must be a string`)
      }
      if (!node.entry || typeof node.entry !== "string") {
        throw new Error(`manifest.json: nodes[${i}].entry is required and must be a string`)
      }
      return {
        type: node.type,
        entry: node.entry,
        category: typeof node.category === "string" ? node.category : undefined,
        description: typeof node.description === "string" ? node.description : undefined,
      }
    })
  }

  let templates: PackageManifestV2Template[] | undefined
  if (m.templates !== undefined) {
    if (!Array.isArray(m.templates)) {
      throw new Error("manifest.json: 'templates' must be an array")
    }
    templates = m.templates.map((t: unknown, i: number) => {
      if (!t || typeof t !== "object") {
        throw new Error(`manifest.json: templates[${i}] must be an object`)
      }
      const tmpl = t as Record<string, unknown>
      if (!tmpl.id || typeof tmpl.id !== "string") {
        throw new Error(`manifest.json: templates[${i}].id is required and must be a string`)
      }
      if (!tmpl.path || typeof tmpl.path !== "string") {
        throw new Error(`manifest.json: templates[${i}].path is required and must be a string`)
      }
      return { id: tmpl.id, path: tmpl.path }
    })
  }

  if (!nodes && !templates) {
    throw new Error("manifest.json: must include at least one of 'nodes' or 'templates'")
  }

  return {
    manifestVersion,
    name: m.name,
    version: m.version,
    description: typeof m.description === "string" ? m.description : undefined,
    author: typeof m.author === "string" ? m.author : undefined,
    nodes,
    templates,
  }
}

function validateManifest(raw: unknown): PackageManifestV1 {
  if (!raw || typeof raw !== "object") {
    throw new Error("manifest.json must be a JSON object")
  }
  const m = raw as Record<string, unknown>

  const manifestVersion = m.manifestVersion !== undefined ? Number(m.manifestVersion) : 1
  if (!Number.isInteger(manifestVersion) || manifestVersion < 1) {
    throw new Error("manifestVersion must be a positive integer")
  }
  if (manifestVersion > SUPPORTED_MANIFEST_VERSION) {
    throw new Error(`manifestVersion ${manifestVersion} is not supported (max: ${SUPPORTED_MANIFEST_VERSION})`)
  }

  if (!m.name || typeof m.name !== "string") {
    throw new Error("manifest.json: 'name' is required and must be a string")
  }
  if (!m.version || typeof m.version !== "string") {
    throw new Error("manifest.json: 'version' is required and must be a string")
  }
  if (!m.nodeType || typeof m.nodeType !== "string") {
    throw new Error("manifest.json: 'nodeType' is required and must be a string")
  }
  if (!m.entry || typeof m.entry !== "string") {
    throw new Error("manifest.json: 'entry' is required and must be a string")
  }

  return {
    manifestVersion,
    name: m.name,
    version: m.version,
    nodeType: m.nodeType,
    entry: m.entry,
    category: typeof m.category === "string" ? m.category : undefined,
    description: typeof m.description === "string" ? m.description : undefined,
    author: typeof m.author === "string" ? m.author : undefined,
  }
}

async function importNodeDefinition(entryPath: string): Promise<NodeDefinition> {
  let mod: Record<string, unknown>
  try {
    mod = await import(pathToFileURL(entryPath).href)
  } catch (err) {
    throw new Error(`Failed to import package entry "${entryPath}": ${err instanceof Error ? err.message : String(err)}`)
  }

  const nodeDef = (mod.default ?? mod) as Partial<NodeDefinition>
  if (!nodeDef || typeof nodeDef !== "object") {
    throw new Error(`Package entry does not export a valid NodeDefinition (got ${typeof nodeDef})`)
  }
  if (!nodeDef.type || typeof nodeDef.type !== "string") {
    throw new Error(`NodeDefinition missing required 'type' field`)
  }
  if (typeof nodeDef.execute !== "function") {
    throw new Error(`NodeDefinition missing required 'execute' function for type "${nodeDef.type}"`)
  }

  return nodeDef as NodeDefinition
}
