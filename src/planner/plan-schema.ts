import { z } from "zod";
import type { Tool } from "../tools/base-tool.js";
import type { PlanStepRecord } from "../types.js";

const StepSchema = z.object({
  description: z.string(),
  tool: z.string().optional(),
  args: z.any().optional(),
  dependsOn: z.array(z.number()).default([]),
});

export const PlanOutputSchema = z.object({
  title: z.string().optional(),
  steps: z.array(StepSchema),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export interface ValidationIssue {
  message: string;
  retryable: boolean;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: string[];
}

const TOOL_REQUIRED_ARGS: Record<string, string[]> = {
  websearch: ["query"],
  webfetch: ["url"],
};

export function validateBusinessRules(
  output: PlanOutput,
  tools: Map<string, Tool>,
  maxSteps: number,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: string[] = [];

  if (output.steps.length === 0) {
    errors.push({ message: "Plan must contain at least one step", retryable: false });
    return { errors, warnings };
  }

  if (output.steps.length > maxSteps) {
    warnings.push(
      `Plan has ${output.steps.length} steps, max is ${maxSteps}. First ${maxSteps} steps will be used.`,
    );
    output.steps = output.steps.slice(0, maxSteps);
  }

  for (let i = 0; i < output.steps.length; i++) {
    const step = output.steps[i];

    if (step.tool) {
      if (!tools.has(step.tool)) {
        errors.push({ message: `Step ${i}: unknown tool "${step.tool}"`, retryable: true });
      }

      const args: Record<string, unknown> = step.args && typeof step.args === "object" ? step.args as Record<string, unknown> : {};
      const required = TOOL_REQUIRED_ARGS[step.tool];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (required) {
        for (const arg of required) {
          if (!(arg in args)) {
            warnings.push(`Step ${i}: "${step.tool}" missing required arg "${arg}"`);
          }
        }
      }
    }

    for (const dep of step.dependsOn) {
      if (!Number.isInteger(dep) || dep < 0 || dep >= output.steps.length) {
        errors.push({ message: `Step ${i}: dependsOn[${dep}] is out of range`, retryable: true });
      }
      if (dep >= i) {
        errors.push({ message: `Step ${i}: dependsOn[${dep}] references a future step`, retryable: true });
      }
    }
  }

  return { errors, warnings };
}

export function normalizePlanOutput(
  output: PlanOutput,
  planId: string,
  maxSteps?: number,
): PlanStepRecord[] {
  const steps = maxSteps !== undefined ? output.steps.slice(0, maxSteps) : output.steps;
  const now = new Date().toISOString();

  return steps.map((step, i) => ({
    id: `step_${i}`,
    planId,
    description: step.description,
    tool: step.tool ?? null,
    args: step.args ? JSON.stringify(step.args) : null,
    dependsOn: JSON.stringify(step.dependsOn.map((d) => `step_${d}`)),
    status: "pending" as const,
    result: null,
    error: null,
    order: i,
    createdAt: now,
    completedAt: null,
  }));
}


