import type { Workflow, IntentStep, IntentTrigger } from "./types.js"
import type { RoundtripNode, RoundtripEdge } from "./dslToGraph.js"

export function graphToDsl(
  nodes: RoundtripNode[],
  edges: RoundtripEdge[],
  overrides?: { id?: string; name?: string; description?: string },
): Workflow {
  const triggerNode = nodes.find((n) => n.id === "__trigger__")
  const stepNodes = nodes.filter((n) => n.id !== "__trigger__")

  let trigger: IntentTrigger | undefined
  if (triggerNode) {
    const rawType = triggerNode.data.step.type.replace("trigger:", "")
    trigger = { type: rawType as IntentTrigger["type"] }
  }

  const steps: IntentStep[] = stepNodes.map((n) => {
    const step: IntentStep = { id: n.data.step.id, type: n.data.step.type }

    if (n.data.step.input !== undefined) {
      step.input = { ...n.data.step.input }
    }

    if (n.data.step.onFailure !== undefined) {
      step.onFailure = { ...n.data.step.onFailure }
    }

    const outgoingEdges = edges
      .filter((e) => e.source === n.id && e.target !== "__trigger__")
      .map((e) => e.target)

    if (outgoingEdges.length === 1) {
      step.next = outgoingEdges[0]
    } else if (outgoingEdges.length > 1) {
      step.next = outgoingEdges
    }

    return step
  })

  return {
    id: overrides?.id ?? `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: overrides?.name,
    description: overrides?.description,
    version: "1.0.0",
    trigger,
    steps,
  }
}
