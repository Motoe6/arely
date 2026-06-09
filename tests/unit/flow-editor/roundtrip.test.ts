import { describe, it, expect } from "vitest"

// ── Types (mirror packages/flow-editor/src/types.ts) ──

interface IntentTrigger {
  type: "manual" | "webhook" | "interval" | "event"
  config?: Record<string, unknown>
}

interface IntentStep {
  id: string
  type: string
  label?: string
  input?: Record<string, unknown>
  next?: string | string[]
  onFailure?: { retry?: { maxAttempts: number; delayMs: number }; fallback?: string }
}

interface Workflow {
  id: string
  name?: string
  description?: string
  version: string
  trigger?: IntentTrigger
  steps: IntentStep[]
}

interface GraphNode {
  id: string
  type: string
  data: {
    step: IntentStep
    label: string
    category: string
    triggerConfig?: Record<string, unknown>
  }
}

interface GraphEdge {
  id: string
  source: string
  target: string
}

// ── Conversion: DSL → Graph ──

function dslToGraph(workflow: Workflow): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  if (workflow.trigger) {
    const nodeData: GraphNode["data"] = {
      step: { id: "__trigger__", type: `trigger:${workflow.trigger.type}` },
      label: `Trigger: ${workflow.trigger.type}`,
      category: "trigger",
    }
    if (workflow.trigger.config && Object.keys(workflow.trigger.config).length > 0) {
      nodeData.triggerConfig = { ...workflow.trigger.config }
    }
    nodes.push({ id: "__trigger__", type: "workflow", data: nodeData })
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

// ── Conversion: Graph → DSL ──

function graphToDsl(
  nodes: GraphNode[],
  edges: GraphEdge[],
  overrides?: { id?: string; name?: string; description?: string },
): Workflow {
  const triggerNode = nodes.find((n) => n.id === "__trigger__")
  const stepNodes = nodes.filter((n) => n.id !== "__trigger__")

  let trigger: IntentTrigger | undefined
  if (triggerNode) {
    const rawType = triggerNode.data.step.type.replace("trigger:", "")
    trigger = { type: rawType as IntentTrigger["type"] }
    if (triggerNode.data.triggerConfig) {
      trigger.config = { ...triggerNode.data.triggerConfig }
    }
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

// ── Helpers ──

/** Normalize `next` into a sorted string[] for comparison */
function normalizeNext(next: string | string[] | undefined): string[] | undefined {
  if (next === undefined) return undefined
  const arr = Array.isArray(next) ? next : [next]
  return arr.sort()
}

/** Strip auto-generated/id fields for comparison */
function comparableWorkflow(wf: Workflow): Omit<Workflow, "id" | "name" | "version"> {
  return { trigger: wf.trigger, steps: wf.steps, description: wf.description }
}

/** Compare two Workflow DSLs structurally (step by step, normalizing next) */
export function expectWorkflowsEqual(actual: Workflow, expected: Workflow): void {
  expect(actual.trigger).toEqual(expected.trigger)

  expect(actual.steps).toHaveLength(expected.steps.length)
  for (let i = 0; i < expected.steps.length; i++) {
    const a = actual.steps[i]
    const e = expected.steps[i]
    expect(a.id).toBe(e.id)
    expect(a.type).toBe(e.type)
    expect(a.input).toEqual(e.input)
    expect(a.onFailure).toEqual(e.onFailure)
    expect(normalizeNext(a.next)).toEqual(normalizeNext(e.next))
    expect(a.label).toBe(e.label)
  }
}

/** Compare step data without `next` (derived from edges, may differ between graph ↔ DSL) */
function stepDataEqual(actual: IntentStep, expected: IntentStep): void {
  expect(actual.id).toBe(expected.id)
  expect(actual.type).toBe(expected.type)
  expect(actual.input).toEqual(expected.input)
  expect(actual.onFailure).toEqual(expected.onFailure)
}

/** Compare two graphs structurally (same nodes + edges, ignoring position and step.next) */
function expectGraphsEqual(
  actual: { nodes: GraphNode[]; edges: GraphEdge[] },
  expected: { nodes: GraphNode[]; edges: GraphEdge[] },
): void {
  const actualSorted = [...actual.edges].sort((a, b) => a.id.localeCompare(b.id))
  const expectedSorted = [...expected.edges].sort((a, b) => a.id.localeCompare(b.id))
  expect(actualSorted).toEqual(expectedSorted)

  expect(actual.nodes).toHaveLength(expected.nodes.length)
  for (const expNode of expected.nodes) {
    const actNode = actual.nodes.find((n) => n.id === expNode.id)
    expect(actNode).toBeDefined()
    expect(actNode!.type).toBe(expNode.type)
    stepDataEqual(actNode!.data.step, expNode.data.step)
    expect(actNode!.data.label).toBe(expNode.data.label)
    expect(actNode!.data.category).toBe(expNode.data.category)
    if (expNode.data.triggerConfig !== undefined || actNode!.data.triggerConfig !== undefined) {
      expect(actNode!.data.triggerConfig).toEqual(expNode.data.triggerConfig)
    }
  }
}

// ── Fixtures ──

function linearWorkflow(): Workflow {
  return {
    id: "test-linear",
    version: "1.0.0",
    trigger: { type: "manual" },
    steps: [
      { id: "fetch", type: "http", input: { url: "https://api.example.com" } },
      { id: "process", type: "llm", input: { prompt: "summarize" } },
      { id: "respond", type: "http", input: { method: "POST" } },
    ],
  }
}

function fanOutWorkflow(): Workflow {
  return {
    id: "test-fanout",
    version: "1.0.0",
    trigger: { type: "webhook", config: { path: "data/ingest" } },
    steps: [
      { id: "ingest", type: "http", next: ["validate", "enrich"] },
      { id: "validate", type: "http" },
      { id: "enrich", type: "llm" },
    ],
  }
}

function noTriggerWorkflow(): Workflow {
  return {
    id: "test-no-trigger",
    version: "1.0.0",
    steps: [
      { id: "step_a", type: "http" },
      { id: "step_b", type: "llm", next: "step_c" },
      { id: "step_c", type: "http" },
    ],
  }
}

function withOnFailureWorkflow(): Workflow {
  return {
    id: "test-onfailure",
    version: "1.0.0",
    trigger: { type: "manual" },
    steps: [
      {
        id: "risky",
        type: "http",
        input: { url: "https://unstable.example.com" },
        next: "fallback",
        onFailure: { retry: { maxAttempts: 3, delayMs: 1000 }, fallback: "fallback" },
      },
      { id: "fallback", type: "http" },
    ],
  }
}

function singleStepWorkflow(): Workflow {
  return {
    id: "test-single",
    version: "1.0.0",
    trigger: { type: "manual" },
    steps: [
      { id: "lonely", type: "http" },
    ],
  }
}

function emptyWorkflow(): Workflow {
  return {
    id: "test-empty",
    version: "1.0.0",
    steps: [],
  }
}

function explicitChainWorkflow(): Workflow {
  return {
    id: "test-explicit-chain",
    version: "1.0.0",
    trigger: { type: "manual" },
    steps: [
      { id: "a", type: "http", next: "b" },
      { id: "b", type: "http", next: "c" },
      { id: "c", type: "http", next: "d" },
      { id: "d", type: "http" },
    ],
  }
}

// ── Tests ──

describe("Roundtrip — DSL → Graph → DSL", () => {
  it("preserves linear chain without explicit next (sequential fallback)", () => {
    const original = linearWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    // dslToGraph does NOT add sequential edges — FlowEditor's auto-edge only adds
    // trigger→firstStep, not sequential step→step. So the roundtripped DSL
    // should NOT have sequential next (the original doesn't either).
    expectWorkflowsEqual(result, original)
  })

  it("preserves explicit next edges (linear chain)", () => {
    const original = explicitChainWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expectWorkflowsEqual(result, original)
  })

  it("preserves fan-out (single source → multiple targets)", () => {
    const original = fanOutWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expectWorkflowsEqual(result, original)
  })

  it("preserves trigger type and config", () => {
    const original = fanOutWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.trigger).toBeDefined()
    expect(result.trigger!.type).toBe("webhook")
    expect(result.trigger!.config).toEqual({ path: "data/ingest" })
  })

  it("handles workflow without trigger", () => {
    const original = noTriggerWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.trigger).toBeUndefined()
    expectWorkflowsEqual(result, original)
  })

  it("preserves input properties on steps", () => {
    const original = linearWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.steps[0].input).toEqual({ url: "https://api.example.com" })
    expect(result.steps[1].input).toEqual({ prompt: "summarize" })
  })

  it("preserves onFailure with retry and fallback", () => {
    const original = withOnFailureWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expectWorkflowsEqual(result, original)
  })

  it("handles single step workflow", () => {
    const original = singleStepWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].id).toBe("lonely")
    expect(result.trigger).toBeDefined()
  })

  it("handles workflow with zero steps", () => {
    const original = emptyWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.steps).toHaveLength(0)
    expect(result.trigger).toBeUndefined()
  })

  it("trigger→firstStep auto-edge is NOT encoded into step.next", () => {
    const original = linearWorkflow()
    const { nodes, edges } = dslToGraph(original)
    // After graph conversion, the trigger→firstStep edge exists
    const triggerEdge = edges.find((e) => e.source === "__trigger__")
    expect(triggerEdge).toBeDefined()
    expect(triggerEdge!.target).toBe("fetch")

    const result = graphToDsl(nodes, edges, { id: original.id })
    // But the first step's `next` should NOT include the trigger
    expect(result.steps[0].next).toBeUndefined()
  })
})

describe("Roundtrip — Graph → DSL → Graph", () => {
  it("preserves nodes and edges for linear chain", () => {
    const originalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        { id: "__trigger__", type: "workflow", data: { step: { id: "__trigger__", type: "trigger:manual" }, label: "Trigger: manual", category: "trigger" } },
        { id: "a", type: "workflow", data: { step: { id: "a", type: "http" }, label: "http", category: "" } },
        { id: "b", type: "workflow", data: { step: { id: "b", type: "llm" }, label: "llm", category: "" } },
      ],
      edges: [
        { id: "__trigger__->a", source: "__trigger__", target: "a" },
        { id: "a->b", source: "a", target: "b" },
      ],
    }

    const wf = graphToDsl(originalGraph.nodes, originalGraph.edges, { id: "test-graph" })
    const resultGraph = dslToGraph(wf)

    expectGraphsEqual(resultGraph, originalGraph)
  })

  it("preserves nodes and edges for fan-out graph", () => {
    const originalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        { id: "__trigger__", type: "workflow", data: { step: { id: "__trigger__", type: "trigger:webhook" }, label: "Trigger: webhook", category: "trigger", triggerConfig: { path: "data/ingest" } } },
        { id: "fetch", type: "workflow", data: { step: { id: "fetch", type: "http", input: { url: "https://x.com" } }, label: "http", category: "" } },
        { id: "save", type: "workflow", data: { step: { id: "save", type: "http" }, label: "http", category: "" } },
        { id: "notify", type: "workflow", data: { step: { id: "notify", type: "http" }, label: "http", category: "" } },
      ],
      edges: [
        { id: "__trigger__->fetch", source: "__trigger__", target: "fetch" },
        { id: "fetch->save", source: "fetch", target: "save" },
        { id: "fetch->notify", source: "fetch", target: "notify" },
      ],
    }

    const wf = graphToDsl(originalGraph.nodes, originalGraph.edges, { id: "test-fanout-graph" })
    const resultGraph = dslToGraph(wf)

    expectGraphsEqual(resultGraph, originalGraph)
  })

  it("preserves nodes and edges for graph without trigger", () => {
    const originalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        { id: "init", type: "workflow", data: { step: { id: "init", type: "http" }, label: "http", category: "" } },
        { id: "cleanup", type: "workflow", data: { step: { id: "cleanup", type: "http" }, label: "http", category: "" } },
      ],
      edges: [
        { id: "init->cleanup", source: "init", target: "cleanup" },
      ],
    }

    const wf = graphToDsl(originalGraph.nodes, originalGraph.edges, { id: "test-no-trigger-graph" })
    const resultGraph = dslToGraph(wf)

    expectGraphsEqual(resultGraph, originalGraph)
  })

  it("preserves onFailure metadata through graph roundtrip", () => {
    const originalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        { id: "__trigger__", type: "workflow", data: { step: { id: "__trigger__", type: "trigger:manual" }, label: "Trigger: manual", category: "trigger" } },
        { id: "step1", type: "workflow", data: { step: { id: "step1", type: "http", onFailure: { retry: { maxAttempts: 5, delayMs: 2000 }, fallback: "recovery" } }, label: "http", category: "" } },
        { id: "recovery", type: "workflow", data: { step: { id: "recovery", type: "http" }, label: "http", category: "" } },
      ],
      edges: [
        { id: "__trigger__->step1", source: "__trigger__", target: "step1" },
        { id: "step1->recovery", source: "step1", target: "recovery" },
      ],
    }

    const wf = graphToDsl(originalGraph.nodes, originalGraph.edges, { id: "test-onfailure-graph" })
    const resultGraph = dslToGraph(wf)

    expectGraphsEqual(resultGraph, originalGraph)
  })
})

describe("Roundtrip property — idempotence", () => {
  it("dslToGraph → graphToDsl → dslToGraph is idempotent on the graph", () => {
    const original = explicitChainWorkflow()
    const graph1 = dslToGraph(original)
    const wf2 = graphToDsl(graph1.nodes, graph1.edges, { id: original.id })
    const graph2 = dslToGraph(wf2)

    expectGraphsEqual(graph2, graph1)
  })

  it("graphToDsl → dslToGraph → graphToDsl is idempotent on the DSL", () => {
    const originalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        { id: "__trigger__", type: "workflow", data: { step: { id: "__trigger__", type: "trigger:manual" }, label: "Trigger: manual", category: "trigger" } },
        { id: "x", type: "workflow", data: { step: { id: "x", type: "http", input: { body: "hello" } }, label: "http", category: "" } },
        { id: "y", type: "workflow", data: { step: { id: "y", type: "llm" }, label: "llm", category: "" } },
      ],
      edges: [
        { id: "__trigger__->x", source: "__trigger__", target: "x" },
        { id: "x->y", source: "x", target: "y" },
      ],
    }

    const wf1 = graphToDsl(originalGraph.nodes, originalGraph.edges, { id: "idempotent" })
    const graph2 = dslToGraph(wf1)
    const wf3 = graphToDsl(graph2.nodes, graph2.edges, { id: "idempotent" })

    expectWorkflowsEqual(wf3, wf1)
  })
})

describe("Edge cases", () => {
  it("terminal step (no outgoing edges) has no next", () => {
    const wf: Workflow = {
      id: "terminal",
      version: "1.0.0",
      trigger: { type: "manual" },
      steps: [
        { id: "only", type: "http" },
      ],
    }

    const { nodes, edges } = dslToGraph(wf)
    const result = graphToDsl(nodes, edges, { id: "terminal" })

    expect(result.steps[0].next).toBeUndefined()
  })

  it("step with single-element next array becomes string after roundtrip", () => {
    // edge case: original DSL uses array-of-one
    const wf: Workflow = {
      id: "array-of-one",
      version: "1.0.0",
      steps: [
        { id: "a", type: "http", next: ["b"] },
        { id: "b", type: "http" },
      ],
    }

    const { nodes, edges } = dslToGraph(wf)
    const result = graphToDsl(nodes, edges, { id: "array-of-one" })

    // During graph → DSL, single edge becomes string, not array
    expect(result.steps[0].next).toBe("b")
    // Information content is preserved (same target step)
    expect(normalizeNext(result.steps[0].next)).toEqual(["b"])
  })

  it("workflow with mixed trigger config types", () => {
    const wf: Workflow = {
      id: "mixed-config",
      version: "1.0.0",
      trigger: { type: "interval", config: { intervalMs: 5000 } },
      steps: [{ id: "check", type: "http" }],
    }

    const { nodes, edges } = dslToGraph(wf)
    const result = graphToDsl(nodes, edges, { id: "mixed-config" })

    expect(result.trigger!.type).toBe("interval")
    expect(result.trigger!.config).toEqual({ intervalMs: 5000 })
  })

  it("step order is preserved through roundtrip", () => {
    const original = explicitChainWorkflow()
    const { nodes, edges } = dslToGraph(original)
    const result = graphToDsl(nodes, edges, { id: original.id })

    expect(result.steps.map((s) => s.id)).toEqual(["a", "b", "c", "d"])
  })
})
