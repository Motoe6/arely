export type MetricUnit = "count" | "percent" | "ratio" | "ms" | "usd" | "tokens" | "score" | "bytes"

export interface BenchmarkMetric {
  name: string
  value: number
  unit: MetricUnit
  threshold?: { operator: "lt" | "lte" | "gt" | "gte" | "eq"; value: number }
  passed?: boolean
}

export interface BenchmarkSuite {
  name: string
  description: string
  metrics: BenchmarkMetric[]
  metadata?: Record<string, unknown>
}

export interface BenchmarkSummary {
  totalSuites: number
  totalMetrics: number
  passed: number
  failed: number
  errored: number
}

export interface BenchmarkReport {
  timestamp: string
  suites: BenchmarkSuite[]
  summary: BenchmarkSummary
}

export interface Collector {
  name: string
  description: string
  collect(): BenchmarkSuite | Promise<BenchmarkSuite>
}
