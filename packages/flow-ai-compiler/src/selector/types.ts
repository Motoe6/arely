import type { NodeDefinition } from "@arely/flow-sdk"

export type MatchStrategy = "exact" | "intent_pattern" | "keyword" | "category_fallback" | "generic_fallback"

export interface SelectorMetadata {
  nodeType: string
  label: string
  category: NodeDefinition["category"]
  keywords: string[]
}

export interface SelectableNode {
  definition: NodeDefinition
  metadata: SelectorMetadata
}

export interface NodeMatch {
  nodeType: string
  confidence: number
  strategy: MatchStrategy
  definition: NodeDefinition
}

export interface ResolvedStep {
  stepId: string
  nodeType: string
  definition: NodeDefinition
  match: NodeMatch
}
