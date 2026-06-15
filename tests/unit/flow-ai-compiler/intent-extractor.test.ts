import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import { createExtractor, validateIntent, enforceConstraints, IntentValidationError, WorkflowIntentSchema } from "@arelyos/flow-ai-compiler"
import type { WorkflowIntent } from "@arelyos/flow-ai-compiler"
import type { CompilerLLMAdapter } from "@arelyos/flow-ai-compiler"

const VALID_INTENT: WorkflowIntent = {
  goal: "send welcome email on user signup",
  triggers: [{ type: "webhook", description: "user signs up" }],
  steps: [
    { id: "fetch_user", description: "get user details", intent: "fetch user data" },
    { id: "send_email", description: "send welcome email", intent: "send email", dependencies: ["fetch_user"] },
  ],
  constraints: { allowLoops: false, requiresDeterminism: true },
}

function createStubAdapter(returnValue: unknown): CompilerLLMAdapter {
  return {
    async generateStructured<T>(_system: string, _prompt: string, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(returnValue) as T
    },
    async health() {
      return { ok: true, model: "stub" }
    },
  }
}

describe("Intent Schema — B.1", () => {
  it("validates a valid WorkflowIntent", () => {
    const result = WorkflowIntentSchema.safeParse(VALID_INTENT)
    expect(result.success).toBe(true)
  })

  it("rejects empty goal", () => {
    const result = WorkflowIntentSchema.safeParse({ ...VALID_INTENT, goal: "" })
    expect(result.success).toBe(false)
  })

  it("rejects allowLoops true", () => {
    const result = WorkflowIntentSchema.safeParse({
      ...VALID_INTENT,
      constraints: { allowLoops: true, requiresDeterminism: true },
    })
    expect(result.success).toBe(false)
  })

  it("rejects requiresDeterminism false", () => {
    const result = WorkflowIntentSchema.safeParse({
      ...VALID_INTENT,
      constraints: { allowLoops: false, requiresDeterminism: false },
    })
    expect(result.success).toBe(false)
  })

  it("accepts empty triggers with valid default", () => {
    const result = WorkflowIntentSchema.safeParse({
      ...VALID_INTENT,
      triggers: [{ type: "manual", description: "manual trigger" }],
    })
    expect(result.success).toBe(true)
  })
})

describe("Intent Validator — validateIntent", () => {
  it("passes on valid intent", () => {
    expect(() => validateIntent(VALID_INTENT)).not.toThrow()
  })

  it("throws on empty steps", () => {
    expect(() => validateIntent({ ...VALID_INTENT, steps: [] })).toThrow("at least one step")
  })

  it("throws on empty triggers", () => {
    expect(() => validateIntent({ ...VALID_INTENT, triggers: [] })).toThrow("at least one trigger")
  })

  it("throws on duplicate step ids", () => {
    expect(() =>
      validateIntent({
        ...VALID_INTENT,
        steps: [
          { id: "dup", description: "a", intent: "x" },
          { id: "dup", description: "b", intent: "y" },
        ],
      }),
    ).toThrow("Duplicate")
  })

  it("throws on reference to unknown step in dependencies", () => {
    expect(() =>
      validateIntent({
        ...VALID_INTENT,
        steps: [
          { id: "step1", description: "a", intent: "x" },
          { id: "step2", description: "b", intent: "y", dependencies: ["nonexistent"] },
        ],
      }),
    ).toThrow("unknown step")
  })

  it("throws when steps exceed maxSteps", () => {
    expect(() =>
      validateIntent({
        ...VALID_INTENT,
        constraints: { allowLoops: false, requiresDeterminism: true, maxSteps: 1 },
      }),
    ).toThrow("exceeds maxSteps")
  })

  it("throws on dependency cycle", () => {
    expect(() =>
      validateIntent({
        ...VALID_INTENT,
        steps: [
          { id: "a", description: "a", intent: "x", dependencies: ["b"] },
          { id: "b", description: "b", intent: "y", dependencies: ["a"] },
        ],
      }),
    ).toThrow("cycle")
  })
})

describe("Intent Validator — enforceConstraints", () => {
  it("injects sequential dependencies when allowParallel is false", () => {
    const intent: WorkflowIntent = {
      ...VALID_INTENT,
      constraints: { allowLoops: false, requiresDeterminism: true, allowParallel: false },
      steps: [
        { id: "s1", description: "first", intent: "x" },
        { id: "s2", description: "second", intent: "y" },
      ],
    }
    const result = enforceConstraints(intent)
    expect(result.steps[1].dependencies).toEqual(["s1"])
  })

  it("triggers array is capped to 1", () => {
    const intent: WorkflowIntent = {
      ...VALID_INTENT,
      triggers: [
        { type: "webhook", description: "webhook" },
        { type: "schedule", description: "schedule" },
      ],
    }
    const result = enforceConstraints(intent)
    expect(result.triggers).toHaveLength(1)
  })
})

describe("Intent Extractor — createExtractor", () => {
  it("extracts valid intent from prompt", async () => {
    const adapter = createStubAdapter(VALID_INTENT)
    const extractor = createExtractor(adapter)
    const intent = await extractor.extractIntent("when a user signs up, send a welcome email")
    expect(intent.goal).toBe("send welcome email on user signup")
    expect(intent.steps).toHaveLength(2)
  })

  it("normalizes prompt before sending to LLM", async () => {
    const adapter = createStubAdapter(VALID_INTENT)
    const extractor = createExtractor(adapter)
    const intent = await extractor.extractIntent("haz un workflow que cuando un usuario se registre, envíale un email")
    expect(intent).toBeDefined()
  })

  it("throws when LLM returns invalid intent", async () => {
    const badAdapter = createStubAdapter({ goal: 42 })
    const extractor = createExtractor(badAdapter)
    await expect(extractor.extractIntent("test")).rejects.toThrow()
  })

  it("rejects intent with zero steps after LLM extraction", async () => {
    const adapter = createStubAdapter({
      ...VALID_INTENT,
      steps: [],
    })
    const extractor = createExtractor(adapter)
    await expect(extractor.extractIntent("do nothing")).rejects.toThrow(IntentValidationError)
  })
})
