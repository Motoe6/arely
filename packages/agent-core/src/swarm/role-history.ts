import * as path from "node:path"
import * as fs from "node:fs"
import type { ProviderCategoryStats } from "./role-types.js"

export interface ProviderBenchmarkEntry {
  successRate: number
  avgLatencyMs: number
  costUsd: number
  utility: number
  score: number
  costEfficiency: number
  scenarioCount: number
}

export interface ProviderBenchmarkSummaryFile {
  timestamp: string
  providers: Record<string, ProviderBenchmarkEntry>
  leaderboard: {
    overall: string[]
    utility: string[]
    cost: string[]
    latency: string[]
    successRate: string[]
    costEfficiency: string[]
  }
}

function findLatestSummaryPath(): string | null {
  const paths = [
    path.resolve("benchmark-reports", "latest-provider-summary.json"),
    path.resolve(process.cwd(), "benchmark-reports", "latest-provider-summary.json"),
  ]

  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }
  return null
}

export function loadProviderSummary(): ProviderBenchmarkSummaryFile | null {
  const summaryPath = findLatestSummaryPath()
  if (!summaryPath) return null

  try {
    const raw = fs.readFileSync(summaryPath, "utf-8")
    return JSON.parse(raw) as ProviderBenchmarkSummaryFile
  } catch {
    return null
  }
}

export function getProviderCategoryStats(summary: ProviderBenchmarkSummaryFile): ProviderCategoryStats[] {
  return Object.entries(summary.providers).map(([provider, data]) => ({
    provider,
    utility: data.utility,
    latency: data.avgLatencyMs,
    successRate: data.successRate,
    costEfficiency: data.costEfficiency,
    score: data.score,
    health: "online" as const,
  }))
}

export function findBestProvider(
  stats: ProviderCategoryStats[],
  key: keyof Pick<ProviderCategoryStats, "score" | "utility" | "costEfficiency" | "successRate"> = "score",
): ProviderCategoryStats | null {
  if (stats.length === 0) return null
  return stats.reduce((a, b) => (a[key] >= b[key] ? a : b))
}
