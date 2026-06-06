import type {
  Workflow,
  WorkflowStep,
  DAGValidationResult,
  DAGEdge,
} from "../types.js"

export function validateDAG(workflow: Workflow): DAGValidationResult {
  const stepIds = new Set(workflow.steps.map((s) => s.id))
  const edges = buildEdges(workflow.steps)
  const cycles = detectCycles(workflow.steps, edges)
  const missingReferences = findMissingReferences(edges, stepIds)
  const selfReferences = findSelfReferences(edges)
  const reachable = computeReachable(workflow.steps, edges)
  const unreachableSteps = workflow.steps
    .map((s) => s.id)
    .filter((id) => !reachable.has(id))

  return {
    valid:
      cycles.length === 0 &&
      missingReferences.length === 0 &&
      selfReferences.length === 0,
    cycles,
    missingReferences,
    selfReferences,
    unreachableSteps,
  }
}

function buildEdges(steps: WorkflowStep[]): DAGEdge[] {
  const edges: DAGEdge[] = []
  const index = new Map(steps.map((s, i) => [s.id, i]))

  for (const step of steps) {
    if (step.next) {
      const targets = typeof step.next === "string" ? [step.next] : step.next
      for (const target of targets) {
        edges.push({ from: step.id, to: target, kind: "next" })
      }
    } else {
      const idx = index.get(step.id)
      if (idx !== undefined && idx < steps.length - 1) {
        const nextStep = steps[idx + 1]
        edges.push({ from: step.id, to: nextStep.id, kind: "next" })
      }
    }

    if (step.onFailure?.fallback) {
      edges.push({
        from: step.id,
        to: step.onFailure.fallback,
        kind: "fallback",
      })
    }
  }

  return edges
}

function detectCycles(steps: WorkflowStep[], edges: DAGEdge[]): string[][] {
  const adj = new Map<string, string[]>()
  for (const s of steps) {
    adj.set(s.id, [])
  }
  for (const e of edges) {
    const list = adj.get(e.from)
    if (list) list.push(e.to)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const cycles: string[][] = []

  for (const s of steps) color.set(s.id, WHITE)

  function dfs(u: string) {
    color.set(u, GRAY)
    for (const v of adj.get(u) ?? []) {
      if (!color.has(v)) continue
      if (color.get(v) === GRAY) {
        const cycle: string[] = [v]
        let cur = u
        while (cur !== v) {
          cycle.push(cur)
          cur = parent.get(cur) ?? ""
        }
        cycle.push(v)
        cycle.reverse()
        cycles.push(cycle)
      } else if (color.get(v) === WHITE) {
        parent.set(v, u)
        dfs(v)
      }
    }
    color.set(u, BLACK)
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      dfs(s.id)
    }
  }

  return cycles
}

function findMissingReferences(
  edges: DAGEdge[],
  stepIds: Set<string>
): { from: string; ref: string; kind: string }[] {
  const missing: { from: string; ref: string; kind: string }[] = []
  for (const e of edges) {
    if (!stepIds.has(e.to)) {
      missing.push({ from: e.from, ref: e.to, kind: e.kind })
    }
  }
  return missing
}

function findSelfReferences(edges: DAGEdge[]): string[] {
  return edges.filter((e) => e.from === e.to).map((e) => e.from)
}

function computeReachable(
  steps: WorkflowStep[],
  edges: DAGEdge[]
): Set<string> {
  const reachable = new Set<string>()

  if (steps.length === 0) return reachable

  const firstId = steps[0].id
  reachable.add(firstId)

  const adj = new Map<string, string[]>()
  for (const s of steps) adj.set(s.id, [])
  for (const e of edges) {
    const list = adj.get(e.from)
    if (list) list.push(e.to)
  }

  const stack = [firstId]
  while (stack.length > 0) {
    const u = stack.pop()!
    for (const v of adj.get(u) ?? []) {
      if (!reachable.has(v)) {
        reachable.add(v)
        stack.push(v)
      }
    }
  }

  return reachable
}
