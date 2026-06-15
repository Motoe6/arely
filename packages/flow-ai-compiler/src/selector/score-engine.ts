import type { NodeMatch } from "./types.js"
import type { SelectableNode } from "./types.js"
import type { NodeDefinition } from "@arelyos/flow-sdk"

export interface IntentStepLike {
  id: string
  description: string
  intent: string
  typeHint?: string
  dependencies?: string[]
  inputHints?: { source?: string; key?: string }
}

export function scoreStep(step: IntentStepLike, node: SelectableNode): NodeMatch {
  const intent = step.intent.toLowerCase()

  if (step.typeHint && step.typeHint.toLowerCase() === node.metadata.nodeType.toLowerCase()) {
    return { nodeType: node.metadata.nodeType, confidence: 1.0, strategy: "exact", definition: node.definition }
  }

  if (node.metadata.keywords.some((k) => intent === k.toLowerCase())) {
    return { nodeType: node.metadata.nodeType, confidence: 0.85, strategy: "intent_pattern", definition: node.definition }
  }

  const intentWords = new Set(intent.split(/\s+/))
  const overlap = node.metadata.keywords.filter((k) => intentWords.has(k.toLowerCase())).length
  if (overlap > 0) {
    const confidence = Math.min(0.5 + overlap * 0.15, 0.8)
    return { nodeType: node.metadata.nodeType, confidence, strategy: "keyword", definition: node.definition }
  }

  return { nodeType: node.metadata.nodeType, confidence: 0, strategy: "keyword", definition: node.definition }
}

function guessCategory(hint: string): NodeDefinition["category"] | null {
  const h = hint.toLowerCase()
  if (["fetch", "send", "http", "request", "call"].includes(h)) return "action"
  if (["ai", "llm", "analyze", "summarize", "generate"].includes(h)) return "ai"
  if (["if", "condition", "switch"].includes(h)) return "logic"
  if (["script", "code", "custom"].includes(h)) return "code"
  return null
}

export class NodeSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NodeSelectionError"
  }
}

export function pickBest(
  matches: NodeMatch[],
  step: IntentStepLike,
  selectables: SelectableNode[],
): NodeMatch {
  const sorted = [...matches].sort((a, b) => b.confidence - a.confidence)
  const best = sorted[0]

  if (best && best.confidence >= 0.5) return best

  if (step.typeHint) {
    const category = guessCategory(step.typeHint)
    if (category) {
    const catMatch = selectables.find((s) => s.metadata.category === category)
    if (catMatch) {
      return { nodeType: catMatch.metadata.nodeType, confidence: 0.4, strategy: "category_fallback", definition: catMatch.definition }
    }
    }
  }

  const httpNode = selectables.find((s) => s.metadata.nodeType === "http")
  if (httpNode) {
    return { nodeType: httpNode.metadata.nodeType, confidence: 0.3, strategy: "generic_fallback", definition: httpNode.definition }
  }

  throw new NodeSelectionError(`No matching node for step "${step.id}": "${step.intent}"`)
}
