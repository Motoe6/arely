import { describe, it, expect } from "vitest"
import { resolveTemplate, extractPlaceholders } from "@arelyos/flow-runtime"
import { TemplateResolutionError } from "@arelyos/flow-runtime"
import type { ExecutionContext } from "@arelyos/flow-runtime"

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    trigger: { payload: { user: { id: "u1", name: "Alice", role: "admin" } } },
    steps: new Map([
      ["get_user", { id: 42, name: "Alice", email: "alice@example.com" }],
      ["fetch_data", { count: 100, items: ["a", "b", "c"] }],
      ["empty_step", {}],
      ["null_step", null as unknown as Record<string, unknown>],
    ]),
    secrets: new Map([["api_key", "sk-1234567890"]]),
    ...overrides,
  }
}

describe("extractPlaceholders", () => {
  it("extracts single placeholder", () => {
    const result = extractPlaceholders("{{ trigger.payload.user.id }}")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      raw: "trigger.payload.user.id",
      source: "trigger",
      path: ["payload", "user", "id"],
    })
  })

  it("extracts multiple placeholders", () => {
    const result = extractPlaceholders(
      "{{ trigger.payload.user.id }} {{ steps.get_user.name }}"
    )
    expect(result).toHaveLength(2)
    expect(result[0].source).toBe("trigger")
    expect(result[1].source).toBe("steps")
  })

  it("ignores escaped placeholders", () => {
    const result = extractPlaceholders("\\{{ not.a.template }}")
    expect(result).toHaveLength(0)
  })

  it("ignores empty braces", () => {
    const result = extractPlaceholders("{{ }}")
    expect(result).toHaveLength(0)
  })

  it("extracts from steps with no sub-path", () => {
    const result = extractPlaceholders("{{ steps.get_user }}")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      raw: "steps.get_user",
      source: "steps",
      path: ["get_user"],
    })
  })

  it("extracts from secrets with no sub-path", () => {
    const result = extractPlaceholders("{{ secrets.api_key }}")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      raw: "secrets.api_key",
      source: "secrets",
      path: ["api_key"],
    })
  })

  it("returns empty array for text without placeholders", () => {
    const result = extractPlaceholders("hello world")
    expect(result).toHaveLength(0)
  })
})

describe("resolveTemplate", () => {
  it("resolves trigger path", () => {
    const result = resolveTemplate("{{ trigger.payload.user.name }}", makeContext())
    expect(result.resolved).toBe("Alice")
  })

  it("resolves step output path", () => {
    const result = resolveTemplate("{{ steps.get_user.email }}", makeContext())
    expect(result.resolved).toBe("alice@example.com")
  })

  it("resolves secrets key", () => {
    const result = resolveTemplate("{{ secrets.api_key }}", makeContext())
    expect(result.resolved).toBe("sk-1234567890")
  })

  it("resolves trigger without sub-path (serializes to JSON)", () => {
    const result = resolveTemplate("{{ trigger }}", makeContext())
    const parsed = JSON.parse(result.resolved)
    expect(parsed.payload.user.name).toBe("Alice")
  })

  it("resolves step without sub-path (serializes to JSON)", () => {
    const result = resolveTemplate("{{ steps.get_user }}", makeContext())
    const parsed = JSON.parse(result.resolved)
    expect(parsed.email).toBe("alice@example.com")
  })

  it("resolves multiple placeholders in one string", () => {
    const result = resolveTemplate(
      "User {{ steps.get_user.name }} ({{ trigger.payload.user.role }})",
      makeContext()
    )
    expect(result.resolved).toBe("User Alice (admin)")
  })

  it("preserves text without placeholders", () => {
    const result = resolveTemplate("hello world", makeContext())
    expect(result.resolved).toBe("hello world")
  })

  it("handles escaped placeholders (backslash)", () => {
    const result = resolveTemplate("\\{{ not.a.template }}", makeContext())
    expect(result.resolved).toBe("{{ not.a.template }}")
  })

  it("handles mixed escaped and active placeholders", () => {
    const result = resolveTemplate(
      "escape: \\{{ literal }}, resolve: {{ steps.get_user.name }}",
      makeContext()
    )
    expect(result.resolved).toBe("escape: {{ literal }}, resolve: Alice")
  })

  it("returns raw and expressions in result", () => {
    const result = resolveTemplate("Hi {{ steps.get_user.name }}", makeContext())
    expect(result.raw).toBe("Hi {{ steps.get_user.name }}")
    expect(result.expressions).toHaveLength(1)
    expect(result.expressions[0].raw).toBe("steps.get_user.name")
  })

  it("serializes numbers", () => {
    const result = resolveTemplate("{{ steps.fetch_data.count }}", makeContext())
    expect(result.resolved).toBe("100")
  })

  it("serializes arrays", () => {
    const result = resolveTemplate("{{ steps.fetch_data.items }}", makeContext())
    const parsed = JSON.parse(result.resolved)
    expect(parsed).toEqual(["a", "b", "c"])
  })

  it("serializes booleans", () => {
    const ctx = makeContext()
    ctx.trigger = { active: true, count: 0 }
    expect(resolveTemplate("{{ trigger.active }}", ctx).resolved).toBe("true")
    expect(resolveTemplate("{{ trigger.count }}", ctx).resolved).toBe("0")
  })
})

describe("resolveTemplate — errors", () => {
  it("throws on missing step reference", () => {
    expect(() =>
      resolveTemplate("{{ steps.undefined_step.output }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })

  it("throws on nonexistent path in step output", () => {
    expect(() =>
      resolveTemplate("{{ steps.get_user.nonexistent }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })

  it("throws on missing secret key", () => {
    expect(() =>
      resolveTemplate("{{ secrets.missing_key }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })

  it("throws on null intermediate value", () => {
    expect(() =>
      resolveTemplate("{{ steps.null_step.field }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })

  it("leaves invalid source expressions as-is for runtime", () => {
    const result = resolveTemplate("{{ invalid.path }}", makeContext())
    expect(result.resolved).toBe("{{ invalid.path }}")
  })

  it("throws on steps without step id", () => {
    expect(() =>
      resolveTemplate("{{ steps }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })

  it("throws on secrets without key name", () => {
    expect(() =>
      resolveTemplate("{{ secrets }}", makeContext())
    ).toThrow(TemplateResolutionError)
  })
})

describe("determinism", () => {
  it("same input always produces same output", () => {
    const template = "{{ steps.get_user.name }} - {{ trigger.payload.user.role }}"
    const ctx = makeContext()

    const results = Array.from({ length: 10 }, () => resolveTemplate(template, ctx))
    const first = results[0].resolved
    for (const r of results) {
      expect(r.resolved).toBe(first)
    }
  })

  it("pure function — no side effects on context", () => {
    const template = "{{ steps.get_user.name }}"
    const ctx = makeContext()
    const stepsBefore = new Map(ctx.steps)

    resolveTemplate(template, ctx)

    expect(ctx.steps).toEqual(stepsBefore)
    expect(ctx.trigger).toEqual(makeContext().trigger)
  })
})

describe("edge cases", () => {
  it("strings with no template braces pass through", () => {
    expect(resolveTemplate("plain text", makeContext()).resolved).toBe("plain text")
  })

  it("empty string", () => {
    expect(resolveTemplate("", makeContext()).resolved).toBe("")
  })

  it("placeholder with extra whitespace", () => {
    const result = resolveTemplate("{{  steps.get_user.name  }}", makeContext())
    expect(result.resolved).toBe("Alice")
  })

  it("resolves empty object step output", () => {
    expect(resolveTemplate("{{ steps.empty_step }}", makeContext()).resolved).toBe("{}")
  })

  it("single step output references work in mixed templates", () => {
    const result = resolveTemplate("{{ steps.get_user }}", makeContext())
    expect(() => JSON.parse(result.resolved)).not.toThrow()
  })
})
