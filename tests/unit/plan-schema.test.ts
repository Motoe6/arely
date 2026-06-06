import { describe, it, expect } from "vitest";
import { PlanOutputSchema, validateBusinessRules, normalizePlanOutput } from "@opencode/engine/planner/plan-schema.js";
import type { Tool } from "@opencode/engine/tools/base-tool.js";

const mockTools = new Map<string, Tool>([
  ["websearch", { name: "websearch", description: "Search", async execute() { return { content: "" }; } }],
  ["webfetch", { name: "webfetch", description: "Fetch", async execute() { return { content: "" }; } }],
]);

describe("PlanOutputSchema", () => {
  it("accepts a valid plan output", () => {
    const result = PlanOutputSchema.safeParse({
      title: "Test plan",
      steps: [
        { description: "Search topic", tool: "websearch", args: { query: "test" }, dependsOn: [] },
        { description: "Analyze results", dependsOn: [0] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing description", () => {
    const result = PlanOutputSchema.safeParse({
      steps: [{ dependsOn: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid dependsOn type", () => {
    const result = PlanOutputSchema.safeParse({
      steps: [
        { description: "A", dependsOn: "invalid" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("validateBusinessRules", () => {
  it("returns empty errors and warnings for valid plan", () => {
    const output = {
      steps: [
        { description: "Search", tool: "websearch", args: { query: "x" }, dependsOn: [] },
        { description: "Analyze", dependsOn: [0] },
      ],
    };

    const result = validateBusinessRules(output, mockTools, 10);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns non-retryable error for empty steps", () => {
    const output = { steps: [] };

    const result = validateBusinessRules(output, mockTools, 10);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].retryable).toBe(false);
  });

  it("returns retryable error for out-of-range dependsOn", () => {
    const output = {
      steps: [
        { description: "A", dependsOn: [] },
        { description: "B", dependsOn: [5] },
      ],
    };

    const result = validateBusinessRules(output, mockTools, 10);
    const depError = result.errors.find((e) => e.message.includes("out of range"));
    expect(depError).toBeDefined();
    expect(depError!.retryable).toBe(true);
  });

  it("returns retryable error for unknown tool", () => {
    const output = {
      steps: [
        { description: "A", tool: "nonexistent", dependsOn: [] },
      ],
    };

    const result = validateBusinessRules(output, mockTools, 10);
    const toolError = result.errors.find((e) => e.message.includes("unknown tool"));
    expect(toolError).toBeDefined();
    expect(toolError!.retryable).toBe(true);
  });

  it("warns when plan exceeds max steps", () => {
    const output = {
      steps: Array.from({ length: 15 }, (_, i) => ({
        description: `Step ${i}`,
        dependsOn: i > 0 ? [i - 1] : ([] as number[]),
      })),
    };

    const result = validateBusinessRules(output, mockTools, 10);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("max is 10");
  });

  it("revalidates dependencies after trim", () => {
    const output = {
      steps: [
        { description: "A", dependsOn: [] as number[] },
        { description: "B", dependsOn: [2] },
        { description: "C", dependsOn: [] as number[] },
      ],
    };

    const result = validateBusinessRules(output, mockTools, 2);
    const depError = result.errors.find((e) => e.message.includes("out of range"));
    expect(depError).toBeDefined();
    expect(depError!.retryable).toBe(true);
    expect(output.steps).toHaveLength(2);
  });

  it("warns when step is missing required tool args", () => {
    const output = {
      steps: [
        { description: "Search", tool: "websearch", dependsOn: [] as number[] },
        { description: "Fetch", tool: "webfetch", args: null, dependsOn: [] as number[] },
        { description: "Good search", tool: "websearch", args: { query: "ok" }, dependsOn: [] as number[] },
      ],
    };

    const result = validateBusinessRules(output, mockTools, 10);
    const argWarnings = result.warnings.filter((w) => w.includes("missing required arg"));
    expect(argWarnings).toHaveLength(2);
    expect(argWarnings[0]).toContain("websearch");
    expect(argWarnings[0]).toContain("query");
    expect(argWarnings[1]).toContain("webfetch");
    expect(argWarnings[1]).toContain("url");
  });
});

describe("normalizePlanOutput", () => {
  it("assigns step_0..step_N IDs and resolves dependsOn to string IDs", () => {
    const output = {
      steps: [
        { description: "Root", dependsOn: [] as number[] },
        { description: "Depends on root", dependsOn: [0] },
      ],
    };

    const steps = normalizePlanOutput(output, "plan-1");

    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe("step_0");
    expect(steps[1].id).toBe("step_1");
    expect(steps[0].dependsOn).toBe("[]");
    expect(steps[1].dependsOn).toBe('["step_0"]');
    expect(steps[0].planId).toBe("plan-1");
  });

  it("converts args to JSON string and null for missing tool", () => {
    const output = {
      steps: [
        { description: "A", tool: "websearch", args: { query: "hello" }, dependsOn: [] as number[] },
        { description: "B", dependsOn: [] as number[] },
      ],
    };

    const steps = normalizePlanOutput(output, "plan-1");

    expect(steps[0].args).toBe('{"query":"hello"}');
    expect(steps[0].tool).toBe("websearch");
    expect(steps[1].args).toBeNull();
    expect(steps[1].tool).toBeNull();
  });

  it("truncates steps beyond maxSteps", () => {
    const output = {
      steps: Array.from({ length: 5 }, (_, i) => ({
        description: `Step ${i}`,
        dependsOn: [] as number[],
      })),
    };

    const steps = normalizePlanOutput(output, "plan-1", 3);

    expect(steps).toHaveLength(3);
    expect(steps[0].id).toBe("step_0");
    expect(steps[2].id).toBe("step_2");
  });
});
