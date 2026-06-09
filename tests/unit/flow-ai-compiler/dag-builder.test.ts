import { describe, it, expect } from "vitest"
import { HttpNode, LLMNode } from "@opencode/flow-sdk"
import type { WorkflowIntent, ResolvedStep } from "@opencode/flow-ai-compiler"
import { buildDag, DagBuildError } from "@opencode/flow-ai-compiler"

function makeResolvedStep(overrides: Partial<ResolvedStep> = {}): ResolvedStep {
  return {
    stepId: overrides.stepId ?? "step",
    nodeType: overrides.nodeType ?? "http",
    definition: HttpNode,
    match: { nodeType: "http", confidence: 1.0, strategy: "exact", definition: HttpNode },
    ...overrides,
  }
}

function makeIntent(overrides: Partial<WorkflowIntent> = {}): WorkflowIntent {
  return {
    goal: "test workflow",
    triggers: [{ type: "manual", description: "manual trigger" }],
    steps: [
      { id: "fetch", description: "fetch user data", intent: "fetch", typeHint: "http", dependencies: [] },
      { id: "process", description: "process the data", intent: "process", typeHint: "llm", dependencies: ["fetch"] },
    ],
    constraints: {},
    ...overrides,
  }
}

describe("DAG Builder — B.3", () => {
  describe("basic DAG construction", () => {
    it("produces a valid Workflow with trigger and steps", () => {
      const intent = makeIntent()
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)

      expect(wf.id).toBe("test-workflow")
      expect(wf.version).toBe("1.0.0")
      expect(wf.trigger).toBeDefined()
      expect(wf.trigger!.type).toBe("manual")
      expect(wf.steps).toHaveLength(2)
    })

    it("maps explicit dependency to next edge", () => {
      const intent = makeIntent()
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)

      const fetchStep = wf.steps.find((s) => s.id === "fetch")!
      expect(fetchStep.next).toBe("process")
    })

    it("assigns next for sequential steps with no explicit deps", () => {
      const intent = makeIntent({
        steps: [
          { id: "a", description: "step a", intent: "fetch", dependencies: [] },
          { id: "b", description: "step b", intent: "process", dependencies: [] },
          { id: "c", description: "step c", intent: "respond", dependencies: [] },
        ],
      })
      const resolved = [
        makeResolvedStep({ stepId: "a", nodeType: "http" }),
        makeResolvedStep({ stepId: "b", nodeType: "llm" }),
        makeResolvedStep({ stepId: "c", nodeType: "http" }),
      ]
      const wf = buildDag(intent, resolved)

      const stepA = wf.steps.find((s) => s.id === "a")!
      const stepB = wf.steps.find((s) => s.id === "b")!
      const stepC = wf.steps.find((s) => s.id === "c")!

      expect(stepA.next).toBe("b")
      expect(stepB.next).toBe("c")
      expect(stepC.next).toBeUndefined()
    })

    it("preserves the resolved step order", () => {
      const intent = makeIntent()
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)

      expect(wf.steps[0].id).toBe("fetch")
      expect(wf.steps[1].id).toBe("process")
    })
  })

  describe("fan-out / parallel steps", () => {
    it("fan-out: one step feeds multiple downstream steps, no sequential spillover", () => {
      const intent: WorkflowIntent = {
        goal: "fanout test",
        triggers: [{ type: "manual", description: "manual" }],
        steps: [
          { id: "fetch", description: "fetch", intent: "fetch", dependencies: [] },
          { id: "process_a", description: "process a", intent: "process", dependencies: ["fetch"] },
          { id: "process_b", description: "process b", intent: "process", dependencies: ["fetch"] },
        ],
        constraints: {},
      }
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process_a", nodeType: "http" }),
        makeResolvedStep({ stepId: "process_b", nodeType: "http" }),
      ]
      const wf = buildDag(intent, resolved)

      const fetchStep = wf.steps.find((s) => s.id === "fetch")!
      const processA = wf.steps.find((s) => s.id === "process_a")!
      const processB = wf.steps.find((s) => s.id === "process_b")!
      expect(fetchStep.next).toBeInstanceOf(Array)
      expect((fetchStep.next as string[]).sort()).toEqual(["process_a", "process_b"])
      expect(processA.next).toBeUndefined()
      expect(processB.next).toBeUndefined()
    })
  })

  describe("trigger mapping", () => {
    it("maps manual trigger type", () => {
      const intent = makeIntent({ triggers: [{ type: "manual", description: "click" }] })
      const wf = buildDag(intent, [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ])
      expect(wf.trigger!.type).toBe("manual")
    })

    it("maps webhook trigger with config path", () => {
      const intent = makeIntent({ triggers: [{ type: "webhook", description: "github push" }] })
      const wf = buildDag(intent, [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ])
      expect(wf.trigger!.type).toBe("webhook")
      expect(wf.trigger!.config).toEqual({ path: "github/push" })
    })

    it("maps schedule trigger with interval", () => {
      const intent = makeIntent({ triggers: [{ type: "schedule", description: "daily" }] })
      const wf = buildDag(intent, [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ])
      expect(wf.trigger!.type).toBe("schedule")
      expect(wf.trigger!.config).toEqual({ intervalMs: 3600000 })
    })

    it("returns undefined for empty triggers", () => {
      const intent = makeIntent({ triggers: [] })
      const wf = buildDag(intent, [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ])
      expect(wf.trigger).toBeUndefined()
    })
  })

  describe("input resolution", () => {
    it("resolves trigger payload hints", () => {
      const intent = makeIntent({
        steps: [
          {
            id: "fetch",
            description: "fetch url",
            intent: "fetch",
            inputHints: { source: "trigger", key: "user_url" },
            dependencies: [],
          },
        ],
      })
      const resolved = [makeResolvedStep({ stepId: "fetch", nodeType: "http" })]
      const wf = buildDag(intent, resolved)
      expect(wf.steps[0].input).toEqual({ url: "{{ trigger.payload.user_url }}" })
    })

    it("resolves previous step reference hints", () => {
      const intent = makeIntent({
        steps: [
          { id: "fetch", description: "fetch", intent: "fetch", dependencies: [] },
          {
            id: "process",
            description: "process",
            intent: "process",
            inputHints: { source: "previous_step", key: "fetch" },
            dependencies: ["fetch"],
          },
        ],
      })
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)
      expect(wf.steps[1].input).toEqual({ body: "{{ steps.fetch }}" })
    })

    it("returns no input for steps with no input hints", () => {
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(makeIntent(), resolved)
      expect(wf.steps[0].input).toBeUndefined()
    })
  })

  describe("workflow ID generation", () => {
    it("generates kebab-case id from goal", () => {
      const intent = makeIntent({ goal: "Process user data daily" })
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)
      expect(wf.id).toBe("process-user-data-daily")
    })

    it("falls back to 'workflow' for empty goal after sanitization", () => {
      const intent = makeIntent({ goal: "!!!" })
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)
      expect(wf.id).toBe("workflow")
    })

    it("truncates id to 64 chars", () => {
      const intent = makeIntent({ goal: "a".repeat(100) })
      const resolved = [
        makeResolvedStep({ stepId: "fetch", nodeType: "http" }),
        makeResolvedStep({ stepId: "process", nodeType: "llm" }),
      ]
      const wf = buildDag(intent, resolved)
      expect(wf.id.length).toBeLessThanOrEqual(64)
    })
  })

  describe("error handling", () => {
    it("throws DagBuildError for empty resolved steps", () => {
      expect(() => buildDag(makeIntent(), [])).toThrow(DagBuildError)
    })

    it("throws DagBuildError when a resolved step has no matching intent step", () => {
      const intent = makeIntent({ steps: [{ id: "a", description: "a", intent: "a", dependencies: [] }] })
      const resolved = [makeResolvedStep({ stepId: "nonexistent", nodeType: "http" })]
      expect(() => buildDag(intent, resolved)).toThrow(DagBuildError)
    })
  })
})
