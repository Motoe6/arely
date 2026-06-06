import type { Tool } from "../tools/base-tool.js";

const BASE_SYSTEM_PROMPT = `You are a planning agent that creates execution plans. Given a user goal, you must produce a JSON plan that breaks the goal into discrete steps that can be executed in sequence or in parallel.

## Output Format

Respond with raw JSON only. Do not use markdown code fences or any other formatting. The JSON must match this structure:

{
  "title": "Brief plan title",
  "steps": [
    {
      "description": "What this step does",
      "tool": "tool_name",
      "args": { "param": "value" },
      "dependsOn": []
    }
  ]
}

- "title" is optional but recommended
- "description" is required (max 500 chars)
- "tool" is the tool to use. Omit or set to null for reasoning-only steps
- "args" are the tool arguments. Omit if no tool
- "dependsOn" is an array of step indices that this step depends on. Use [] for root steps. Steps can only depend on earlier steps (lower indices).

## Dependency Rules

- Root steps have dependsOn: []
- If step B needs step A's result, set B.dependsOn to [A_index]
- Steps at the same level with no cross-dependencies will run in parallel
- A step can depend on multiple earlier steps: [0, 2]

## Planning Guidelines

1. Break the goal into 3-10 steps
2. Each step should have a single clear purpose
3. Use websearch to find information, webfetch to read specific pages
4. Use reasoning steps (no tool) to analyze, synthesize, or decide
5. Order steps logically: research → analyze → produce output
6. Parallelize independent research tasks`;

export function buildToolDescriptions(tools: Map<string, Tool>): string {
  if (tools.size === 0) return "";

  const lines: string[] = ["## Available Tools"];
  for (const tool of tools.values()) {
    lines.push(`- ${tool.name}: ${tool.description}`);
  }
  return lines.join("\n");
}

export function buildPlannerPrompt(
  goal: string,
  toolDescriptions: string,
  maxSteps: number,
): string {
  const sections = [BASE_SYSTEM_PROMPT];

  if (toolDescriptions) {
    sections.push(toolDescriptions);
  }

  sections.push(`## Constraints

- Maximum ${maxSteps} steps
- Each description must be clear and actionable
- Tool arguments must match the tool's expected parameters`);

  sections.push(`## Goal

${goal}`);

  return sections.join("\n\n");
}

export function buildRetryPrompt(previousResponse: string, errors: string[]): string {
  const errorList = errors.map((e) => `- ${e}`).join("\n");

  return `The previous plan had validation errors:\n${errorList}\n\nPlease produce a corrected JSON plan that fixes these errors. Previous response:\n\n${previousResponse}`;
}
