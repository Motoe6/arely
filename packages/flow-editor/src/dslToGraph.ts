import type { Workflow, IntentStep } from "./types.js"

export interface RoundtripNode {
  id: string
  type: string
  data: { step: IntentStep; label: string; category: string }
}

export interface RoundtripEdge {
  id: string
  source: string
  target: string
}

export function dslToGraph(workflow: Workflow): { nodes: RoundtripNode[]; edges: RoundtripEdge[] } {
  const nodes: RoundtripNode[] = []
  const edges: RoundtripEdge[] = []

  if (workflow.trigger) {
    nodes.push({
      id: "__trigger__",
      type: "workflow",
      data: {
        step: { id: "__trigger__", type: `trigger:${workflow.trigger.type}` },
        label: `Trigger: ${workflow.trigger.type}`,
        category: "trigger",
      },
    })
  }

  for (const step of workflow.steps) {
    nodes.push({
      id: step.id,
      type: "workflow",
      data: { step: { ...step }, label: step.type, category: "" },
    })
  }

  const stepMap = new Map(workflow.steps.map((s) => [s.id, s]))
  for (const step of workflow.steps) {
    if (step.next) {
      const targets = Array.isArray(step.next) ? step.next : [step.next]
      for (const t of targets) {
        if (stepMap.has(t)) {
          edges.push({ id: `${step.id}->${t}`, source: step.id, target: t })
        }
      }
    }
  }

  if (workflow.trigger && workflow.steps.length > 0) {
    const firstStep = workflow.steps[0]
    if (firstStep) {
      const hasExistingEdge = edges.some(
        (e) => e.source === "__trigger__" && e.target === firstStep.id,
      )
      if (!hasExistingEdge) {
        edges.push({ id: `__trigger__->${firstStep.id}`, source: "__trigger__", target: firstStep.id })
      }
    }
  }

  return { nodes, edges }
}
