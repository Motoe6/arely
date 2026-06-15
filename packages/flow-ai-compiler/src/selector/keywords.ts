import type { NodeDefinition } from "@arely/flow-sdk"
import type { SelectorMetadata } from "./types.js"

const CATEGORY_KEYWORDS: Record<NodeDefinition["category"], string[]> = {
  action: ["fetch", "send", "request", "call", "invoke", "execute"],
  ai: ["ai", "llm", "generate", "analyze", "summarize", "classify", "extract"],
  logic: ["if", "condition", "branch", "transform", "switch", "match"],
  code: ["script", "custom", "execute", "run", "transform"],
  trigger: ["watch", "listen", "webhook", "poll", "monitor"],
}

const CUSTOM_KEYWORDS = new Map<string, string[]>()

export function registerCustomKeywords(nodeType: string, keywords: string[]): void {
  const existing = CUSTOM_KEYWORDS.get(nodeType) ?? []
  CUSTOM_KEYWORDS.set(nodeType, [...new Set([...existing, ...keywords])])
}

export function getCustomKeywords(nodeType: string): string[] {
  return CUSTOM_KEYWORDS.get(nodeType) ?? []
}

export function deriveMetadata(def: NodeDefinition): SelectorMetadata {
  const fromLabel = def.label.toLowerCase().split(/\s+/)
  const fromCategory = CATEGORY_KEYWORDS[def.category] ?? []
  const custom = getCustomKeywords(def.type)

  const keywords = [
    def.type.toLowerCase(),
    ...fromLabel,
    def.category,
    ...fromCategory,
    ...custom,
  ]

  return {
    nodeType: def.type,
    label: def.label,
    category: def.category,
    keywords: [...new Set(keywords)],
  }
}
