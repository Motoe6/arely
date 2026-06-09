import type { IncomingMessage, ServerResponse } from "node:http"
import { existsSync } from "node:fs"
import { isAbsolute, join, resolve, normalize } from "node:path"
import { ulid } from "ulid"
import type { Router } from "../transport/router.js"
import type { SSEBus } from "../server/sse.js"
import type { NodePackageLoader } from "./node-package-loader.js"
import { listInstalledPackages, getInstalledPackage } from "./package-store.js"
import { listInstalledNodes } from "./node-marketplace-store.js"

interface PackageRoutesOptions {
  loader: NodePackageLoader
  packagesDir: string
  sse: SSEBus
}

export function registerPackageRoutes(router: Router, opts: PackageRoutesOptions): void {
  const { loader, packagesDir, sse } = opts

  router.post("/api/flow/packages/install", (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = ((req as unknown as Record<string, unknown>).body as { packageDir?: string }) ?? {}

      if (!body.packageDir || typeof body.packageDir !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "packageDir is required" }))
        return
      }

      const resolvedDir = resolve(isAbsolute(body.packageDir) ? body.packageDir : join(packagesDir, body.packageDir))
      const normalizedPackagesDir = resolve(packagesDir)
      if (!resolvedDir.startsWith(normalizedPackagesDir)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Package directory must be inside the packages directory" }))
        return
      }
      if (!existsSync(resolvedDir)) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: `Package directory not found: ${resolvedDir}` }))
        return
      }

      loader.loadPackageV2(resolvedDir, {
        onTemplateError: (templateId, err) => {
          console.warn(`[package-routes] Template error for "${templateId}": ${err.message}`)
        },
        onNodeError: (nodeType, err) => {
          console.warn(`[package-routes] Node error for "${nodeType}": ${err.message}`)
        },
      })
        .then((id) => {
          const record = getInstalledPackage(id)
          if (record) {
            sse.emitSystem({
              id: ulid(),
              version: 1 as const,
              timestamp: Date.now(),
              type: "package_installed",
              packageId: record.id,
              name: record.name,
              version: record.version,
            })
          }
          res.writeHead(201, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, package: record }))
        })
        .catch((err: unknown) => {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        })
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Invalid JSON", message: String(err) }))
    }
  })

  router.get("/api/flow/packages", (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const packages = listInstalledPackages()
      const nodes = listInstalledNodes()
      const result = packages.map((pkg) => ({
        ...pkg,
        nodes: nodes.filter((n) => n.name === pkg.name && n.version === pkg.version),
      }))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, packages: result }))
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  router.delete("/api/flow/packages/:id", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const record = getInstalledPackage(params.id)
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Package not found" }))
        return
      }
      loader.removePackage(params.id)
      sse.emitSystem({
        id: ulid(),
        version: 1 as const,
        timestamp: Date.now(),
        type: "package_removed",
        packageId: record.id,
        name: record.name,
        version: record.version,
      })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
}
