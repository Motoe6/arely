import type { ProviderCategoryStats } from "./role-types.js"

export interface ScoreInput {
  historicalScore: number
  utility: number
  availability: number
  costEfficiency: number
  latencyScore: number
}

export function computeEffectiveScore(input: ScoreInput): number {
  const raw =
    input.historicalScore * 0.50 +
    input.utility * 0.20 +
    input.availability * 0.15 +
    input.costEfficiency * 0.10 +
    input.latencyScore * 0.05

  return Math.max(0, Math.min(1, raw))
}

export function computeAvailability(
  health: ProviderCategoryStats["health"],
): number {
  switch (health) {
    case "online":
      return 1.0
    case "rate_limited":
      return 0.5
    case "unauthorized":
      return 0.1
    case "offline":
      return 0.0
  }
}

export function computeLatencyScore(latencyMs: number, maxMs: number = 60000): number {
  if (maxMs <= 0) return 0.5
  const raw = 1 - latencyMs / maxMs
  return Math.max(0, Math.min(1, raw))
}
