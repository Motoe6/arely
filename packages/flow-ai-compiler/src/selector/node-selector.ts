import type { NodeRegistry } from "@arelyos/flow-sdk"
import { deriveMetadata } from "./keywords.js"
import { scoreStep, pickBest } from "./score-engine.js"
import type { SelectableNode, ResolvedStep } from "./types.js"
import type { IntentStepLike } from "./score-engine.js"

export function selectNodes(
  steps: IntentStepLike[],
  registry: NodeRegistry,
): ResolvedStep[] {
  const selectables: SelectableNode[] = registry.list().map((def) => ({
    definition: def,
    metadata: deriveMetadata(def),
  }))

  if (selectables.length === 0) {
    throw new Error("No nodes registered in NodeRegistry — cannot select any step type")
  }

  return steps.map((step) => {
    const matches = selectables.map((node) => scoreStep(step, node))
    const best = pickBest(matches, step, selectables)
    return {
      stepId: step.id,
      nodeType: best.nodeType,
      definition: best.definition,
      match: best,
    }
  })
}
