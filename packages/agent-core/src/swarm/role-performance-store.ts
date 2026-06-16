import * as fs from "node:fs"
import * as path from "node:path"
import type { RolePerformanceRecord, ProviderRoleStats } from "./learning-types.js"
import type { SwarmRole, TaskCategory } from "./role-types.js"

const ROLE_HISTORY_DIR = path.resolve("benchmark-reports", "role-history")

function ensureDir(): void {
  fs.mkdirSync(ROLE_HISTORY_DIR, { recursive: true })
}

export function recordPerformance(record: RolePerformanceRecord): void {
  ensureDir()
  const filename = `role-${record.sessionId}.json`
  const filePath = path.join(ROLE_HISTORY_DIR, filename)
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8")
}

export function loadPerformanceHistory(): RolePerformanceRecord[] {
  ensureDir()
  const files = fs.readdirSync(ROLE_HISTORY_DIR).filter((f) => f.startsWith("role-") && f.endsWith(".json"))
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(ROLE_HISTORY_DIR, f), "utf-8")
    return JSON.parse(raw) as RolePerformanceRecord
  })
}

export function getStatsByCategory(
  records: RolePerformanceRecord[],
  category: TaskCategory,
): ProviderRoleStats[] {
  const filtered = records.filter((r) => r.category === category)

  const groups = new Map<string, { total: number; successes: number; totalUtility: number; totalLatency: number }>()

  for (const r of filtered) {
    const key = `${r.provider}:${r.model}`
    const g = groups.get(key) ?? { total: 0, successes: 0, totalUtility: 0, totalLatency: 0 }
    g.total++
    if (r.success) g.successes++
    g.totalUtility += r.utility
    g.totalLatency += r.latencyMs
    groups.set(key, g)
  }

  return Array.from(groups.entries()).map(([key, g]) => {
    const [provider] = key.split(":")
    return {
      provider,
      model: key.split(":").slice(1).join(":"),
      successRate: g.total > 0 ? g.successes / g.total : 0,
      avgUtility: g.total > 0 ? g.totalUtility / g.total : 0,
      avgLatencyMs: g.total > 0 ? g.totalLatency / g.total : 0,
      count: g.total,
    }
  })
}

export function getStatsByRole(
  records: RolePerformanceRecord[],
  role: SwarmRole,
): ProviderRoleStats[] {
  const filtered = records.filter((r) => r.role === role)

  const groups = new Map<string, { total: number; successes: number; totalUtility: number; totalLatency: number }>()

  for (const r of filtered) {
    const key = `${r.provider}:${r.model}`
    const g = groups.get(key) ?? { total: 0, successes: 0, totalUtility: 0, totalLatency: 0 }
    g.total++
    if (r.success) g.successes++
    g.totalUtility += r.utility
    g.totalLatency += r.latencyMs
    groups.set(key, g)
  }

  return Array.from(groups.entries()).map(([key, g]) => {
    const [provider] = key.split(":")
    return {
      provider,
      model: key.split(":").slice(1).join(":"),
      successRate: g.total > 0 ? g.successes / g.total : 0,
      avgUtility: g.total > 0 ? g.totalUtility / g.total : 0,
      avgLatencyMs: g.total > 0 ? g.totalLatency / g.total : 0,
      count: g.total,
    }
  })
}
