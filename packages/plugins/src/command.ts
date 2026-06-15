export interface ToolContext {
  sessionId: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface CommandParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface CommandDefinition {
  names: string[];
  description: string;
  parameters: CommandParameter[];
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const COMMAND_REGISTRY = new Map<string, CommandDefinition>();

export function defineCommand(def: CommandDefinition): CommandDefinition {
  for (const name of def.names) {
    COMMAND_REGISTRY.set(name, def);
    if (name !== def.names[0]) {
      COMMAND_REGISTRY.set(name, def);
    }
  }
  return def;
}

export function getCommand(name: string): CommandDefinition | undefined {
  return COMMAND_REGISTRY.get(name);
}

export function getAllCommands(): CommandDefinition[] {
  const seen = new Set<string>();
  const result: CommandDefinition[] = [];
  for (const def of COMMAND_REGISTRY.values()) {
    const key = def.names[0];
    if (!seen.has(key)) {
      seen.add(key);
      result.push(def);
    }
  }
  return result;
}

export function clearCommands(): void {
  COMMAND_REGISTRY.clear();
}

export function buildFunctionSpecs(commands: CommandDefinition[]): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return commands.map((cmd) => ({
    name: cmd.names[0],
    description: cmd.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        cmd.parameters.map((p) => [
          p.name,
          {
            type: p.type,
            description: p.description,
            ...(p.enum ? { enum: p.enum } : {}),
          },
        ]),
      ),
      required: cmd.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }));
}

export async function executeCommand(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const cmd = COMMAND_REGISTRY.get(name);
  if (!cmd) {
    return { content: `Unknown command: ${name}` };
  }
  return cmd.execute(args, ctx);
}
