import * as p from "@clack/prompts";
import pc from "picocolors";

export { intro, outro, note, spinner, log, cancel, isCancel } from "@clack/prompts";

export const green = pc.green;
export const red = pc.red;
export const dim = pc.dim;
export const bold = pc.bold;
export const cyan = pc.cyan;

export function box(title: string, lines: string[]): void {
  const width = Math.max(title.length + 4, ...lines.map((l) => l.length + 4), 40);
  console.log(`┌${"─".repeat(width - 2)}┐`);
  console.log(`│ ${title.padEnd(width - 4)} │`);
  console.log(`├${"─".repeat(width - 2)}┤`);
  for (const line of lines) {
    if (line.startsWith("─")) {
      console.log(`├${"─".repeat(width - 2)}┤`);
    } else {
      console.log(`│ ${line.padEnd(width - 4)} │`);
    }
  }
  console.log(`└${"─".repeat(width - 2)}┘`);
}

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export function renderBrand(): void {
  clearScreen();
  console.log(`  ${green("◆")}  ${bold("ARELY")}  ${dim("v1")}`);
  console.log(`  ${dim("Agent · Memory · Strategy · Local-first")}\n`);
}
