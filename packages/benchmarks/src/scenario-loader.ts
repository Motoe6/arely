import * as fs from "node:fs";
import * as path from "node:path";
import type { Scenario } from "./scenario-types.js";

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const yaml = match[1];
  const data: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (val === "true") data[key] = true;
    else if (val === "false") data[key] = false;
    else data[key] = val.replace(/^["']|["']$/g, "");
  }
  return data;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export function loadScenarios(scenariosDir: string): Scenario[] {
  const scenarios: Scenario[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md")) {
        const filePath = path.join(dir, entry.name);
        const content = fs.readFileSync(filePath, "utf-8");
        const meta = parseFrontmatter(content);
        const prompt = stripFrontmatter(content);

        const category = path.basename(path.dirname(filePath)) as Scenario["category"];
        const tags = (meta.tags as string[]) ?? [];

        scenarios.push({
          id: (meta.id as string) ?? path.basename(entry.name, ".md"),
          category,
          title: (meta.title as string) ?? path.basename(entry.name, ".md"),
          tags,
          difficulty: (meta.difficulty as string) ?? "medium",
          successCriteria: (meta.success_criteria as string[]) ?? [],
          expectedToolCalls: (meta.expected_tool_calls as number) ?? 3,
          expectedTokensMax: (meta.expected_tokens_max as number) ?? 2000,
          swarmRoles: meta.swarm_roles as string[] | undefined,
          prompt,
        });
      }
    }
  }

  walk(scenariosDir);
  return scenarios;
}

export function formatScenario(scenario: Scenario): string {
  return `\n  ${scenario.title.padEnd(40)} ${scenario.category.padEnd(12)} ${scenario.difficulty.padEnd(8)} ${scenario.expectedToolCalls} tools`;
}
