import type {
  RoleAssignment,
  SwarmRole,
  TaskCategory,
  ProviderCategoryStats,
} from "./role-types.js"
import { SWARM_ROLES, ROLE_CATEGORY_MAP } from "./role-types.js"
import { computeAvailability, computeLatencyScore } from "./role-score.js"
import type { LearnedWeights } from "./learning-types.js"
import { DEFAULT_WEIGHTS } from "./learning-types.js"
import { getWeightsForCategory, loadLearnedWeights } from "./role-learning.js"

export interface SelectorInput {
  taskCategory: TaskCategory
  providerStats: ProviderCategoryStats[]
  /** Preferred role overrides (e.g. always use claude for planning) */
  roleHints?: Partial<Record<SwarmRole, { provider?: string; model?: string }>>
  /** Optional override weights per category */
  learnedWeights?: Record<TaskCategory, LearnedWeights>
}

function effectiveScoreWithWeights(
  s: ProviderCategoryStats,
  weights: LearnedWeights,
): number {
  const availability = computeAvailability(s.health)
  const latencyScore = computeLatencyScore(s.latency, 60000)

  const raw =
    s.score * weights.historicalScore +
    s.utility * weights.utility +
    availability * weights.availability +
    s.costEfficiency * weights.costEfficiency +
    latencyScore * weights.latencyScore

  return Math.max(0, Math.min(1, raw))
}

function selectForRole(
  role: SwarmRole,
  category: TaskCategory,
  stats: ProviderCategoryStats[],
  weights: LearnedWeights,
  hints?: SelectorInput["roleHints"],
): RoleAssignment {
  const hint = hints?.[role]

  if (hint?.provider && hint?.model) {
    return {
      role,
      provider: hint.provider,
      model: hint.model,
      confidence: 1.0,
      score: 1.0,
      category,
      reason: "Explicit role hint",
    }
  }

  const scored = stats.map((s) => ({
    stat: s,
    effectiveScore: effectiveScoreWithWeights(s, weights),
  }))

  const ranked = scored.sort((a, b) => b.effectiveScore - a.effectiveScore)

  if (ranked.length === 0) {
    return {
      role,
      provider: "openai",
      model: "gpt-4o",
      confidence: 0.5,
      score: 0.5,
      category,
      reason: "Fallback — no provider stats available",
    }
  }

  const best = ranked[0]
  const model = hint?.model ?? inferModelForRole(role, best.stat.provider)

  return {
    role,
    provider: best.stat.provider,
    model,
    confidence: Math.round(best.effectiveScore * 100) / 100,
    score: Math.round(best.effectiveScore * 1000) / 1000,
    category,
    reason: `Best score: ${best.effectiveScore.toFixed(3)} (rank 1/${ranked.length})`,
  }
}

function inferModelForRole(role: SwarmRole, provider: string): string {
  const providerDefaults: Record<string, string> = {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4",
    openrouter: "deepseek/deepseek-v4-flash:free",
    ollama: "qwen2.5:3b",
    lmstudio: "local-model",
  }

  const roleModels: Partial<Record<SwarmRole, Partial<Record<string, string>>>> = {
    coder: {
      openai: "gpt-4o",
      anthropic: "claude-sonnet-4",
      ollama: "qwen2.5-coder:7b",
    },
    researcher: {
      anthropic: "claude-sonnet-4",
      openai: "gpt-4o",
    },
    planner: {
      anthropic: "claude-sonnet-4",
      openai: "gpt-4o",
    },
    reviewer: {
      openai: "gpt-4.1-mini",
      anthropic: "claude-haiku-3-5",
    },
    synthesizer: {
      anthropic: "claude-sonnet-4",
      openai: "gpt-4o",
    },
  }

  return roleModels[role]?.[provider] ?? providerDefaults[provider] ?? "gpt-4o"
}

export function selectRoles(input: SelectorInput): RoleAssignment[] {
  const { taskCategory, providerStats, roleHints, learnedWeights } = input

  const onlineStats = providerStats.filter((s) => s.health === "online")
  const effectiveStats = onlineStats.length > 0 ? onlineStats : providerStats
  const weights = learnedWeights?.[taskCategory] ?? getWeightsForCategory(loadLearnedWeights(), taskCategory)

  return SWARM_ROLES.map((role) => selectForRole(role, taskCategory, effectiveStats, weights, roleHints))
}

export function selectRole(
  role: SwarmRole,
  input: SelectorInput,
): RoleAssignment {
  const assignments = selectRoles(input)
  return assignments.find((a) => a.role === role) ?? assignments[0]
}
