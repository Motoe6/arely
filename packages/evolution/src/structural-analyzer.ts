import type { Template } from "./types.js"
import type { StructuralFeature, StructuralPattern, StructuralPatternMatch } from "./structural-pattern-types.js"

export class StructuralAnalyzer {
  analyze(template: Template): StructuralFeature {
    const obj = template.workflowObj as Record<string, unknown>
    const steps = (obj.steps ?? []) as Record<string, unknown>[]
    const trigger = (obj.trigger ?? {}) as Record<string, unknown>
    const name = (obj.name ?? "") as string

    const stepTypes = steps.map((s) => String(s.type ?? ""))
    const hasChaining = steps.some((s) => s.next !== undefined)
    const hasFanOut = steps.some((s) => Array.isArray(s.next))

    const maxChainDepth = this.computeMaxChainDepth(steps)
    const hasConditionalBranches = hasFanOut

    const hasErrorHandling = steps.some((s) => {
      const of = s.onFailure as Record<string, unknown> | undefined
      return of !== undefined && Object.keys(of).length > 0
    })

    const hasRetryConfig = steps.some((s) => {
      const of = s.onFailure as Record<string, unknown> | undefined
      return of?.retry !== undefined
    })

    const triggerType = String(trigger.type ?? "manual")

    const paramRegex = /\{\{\s*param:(\w+)\s*\}\}/
    const usesDynamicName = paramRegex.test(name)

    const params = template.metadata.parameters ?? []
    const parameterCount = params.length
    const isParameterized = parameterCount > 0

    return {
      stepCount: steps.length,
      stepTypes,
      hasChaining,
      maxChainDepth,
      hasConditionalBranches,
      hasFanOut,
      hasErrorHandling,
      hasRetryConfig,
      triggerType,
      usesDynamicName,
      parameterCount,
      isParameterized,
    }
  }

  detectPatterns(template: Template, feature?: StructuralFeature): StructuralPatternMatch[] {
    const f = feature ?? this.analyze(template)
    const matches: StructuralPatternMatch[] = []

    if (f.stepCount === 1) {
      matches.push({ pattern: "single_step", templateId: template.metadata.id, label: "Single step" })
    }

    if (f.stepCount >= 2 && f.hasChaining) {
      matches.push({ pattern: "multi_step_chain", templateId: template.metadata.id, label: "Multi-step chain" })
    }

    if (this.isStrictHttpLlmChain(f.stepTypes)) {
      matches.push({ pattern: "http_llm_chain", templateId: template.metadata.id, label: "HTTP → LLM chain" })
    }

    if (f.triggerType === "webhook") {
      matches.push({ pattern: "webhook_trigger", templateId: template.metadata.id, label: "Webhook trigger" })
    }

    if (f.triggerType === "schedule") {
      matches.push({ pattern: "schedule_trigger", templateId: template.metadata.id, label: "Schedule trigger" })
    }

    if (f.hasErrorHandling) {
      matches.push({ pattern: "has_onfailure_handling", templateId: template.metadata.id, label: "Has error handling" })
    }

    if (f.hasRetryConfig) {
      matches.push({ pattern: "has_retry_config", templateId: template.metadata.id, label: "Has retry config" })
    }

    if (f.usesDynamicName) {
      matches.push({ pattern: "dynamic_name", templateId: template.metadata.id, label: "Dynamic name" })
    }

    if (f.isParameterized) {
      matches.push({ pattern: "parameterized", templateId: template.metadata.id, label: "Parameterized" })
    }

    return matches
  }

  private isStrictHttpLlmChain(stepTypes: string[]): boolean {
    if (stepTypes.length < 2) return false
    return stepTypes[0] === "http" && stepTypes[1] === "llm"
  }

  private computeMaxChainDepth(steps: Record<string, unknown>[]): number {
    const stepMap = new Map<string, Record<string, unknown>>()
    for (const s of steps) {
      const id = String(s.id ?? "")
      stepMap.set(id, s)
    }

    const memo = new Map<string, number>()

    const depth = (stepId: string): number => {
      if (memo.has(stepId)) return memo.get(stepId)!
      const s = stepMap.get(stepId)
      if (!s) { memo.set(stepId, 1); return 1 }
      const next = s.next
      if (next === undefined || next === null) { memo.set(stepId, 1); return 1 }
      if (typeof next === "string") {
        const d = 1 + depth(next)
        memo.set(stepId, d)
        return d
      }
      if (Array.isArray(next)) {
        const maxBranch = Math.max(...next.map((n: string) => depth(n)), 0)
        const d = 1 + maxBranch
        memo.set(stepId, d)
        return d
      }
      memo.set(stepId, 1)
      return 1
    }

    const startSteps = steps.filter((s) => {
      const id = String(s.id ?? "")
      return !steps.some(
        (other) => {
          const n = other.next
          if (typeof n === "string") return n === id
          if (Array.isArray(n)) return n.includes(id)
          return false
        },
      )
    })

    if (startSteps.length === 0) return steps.length > 0 ? 1 : 0
    return Math.max(...startSteps.map((s) => depth(String(s.id ?? ""))), 0)
  }
}
