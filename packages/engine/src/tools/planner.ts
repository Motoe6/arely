import type {
  ToolDescriptor,
  ToolAvailabilityContext,
  ToolAvailabilityDiagnostic,
  ToolAvailabilityExpression,
  ToolAvailabilitySignal,
  ToolPlan,
  ToolPlanEntry,
  HiddenToolPlanEntry,
  JsonPrimitive,
  JsonObject,
} from "./descriptor.js";

function evaluateSignal(
  signal: ToolAvailabilitySignal,
  ctx: ToolAvailabilityContext,
): { available: boolean; diagnostic?: ToolAvailabilityDiagnostic } {
  switch (signal.kind) {
    case "always":
      return { available: true };
    case "config": {
      let val: JsonPrimitive | undefined;
      let cur: unknown = ctx.config;
      for (const segment of signal.path) {
        if (cur && typeof cur === "object") {
          cur = (cur as JsonObject)[segment];
        } else {
          cur = undefined;
          break;
        }
      }
      val = cur as JsonPrimitive | undefined;
      if (signal.check === "non-empty") {
        return val && val !== ""
          ? { available: true }
          : { available: false, diagnostic: { reason: "config-missing", message: `config ${signal.path.join(".")} is empty` } };
      }
      return val !== undefined
        ? { available: true }
        : { available: false, diagnostic: { reason: "config-missing", message: `config ${signal.path.join(".")} not set` } };
    }
    case "env":
      return ctx.env?.[signal.name]
        ? { available: true }
        : { available: false, diagnostic: { reason: "env-missing", message: `env ${signal.name} not set` } };
    case "plugin-enabled":
      return ctx.enabledPluginIds?.has(signal.pluginId)
        ? { available: true }
        : { available: false, diagnostic: { reason: "plugin-disabled", message: `plugin ${signal.pluginId} not enabled` } };
    case "auth":
      return { available: true };
    default:
      return { available: false, diagnostic: { reason: "unknown-signal", message: `unknown signal kind` } };
  }
}

function evaluateExpression(
  expr: ToolAvailabilityExpression,
  ctx: ToolAvailabilityContext,
): { available: boolean; diagnostics: ToolAvailabilityDiagnostic[] } {
  if ("kind" in expr) {
    const result = evaluateSignal(expr as ToolAvailabilitySignal, ctx);
    return { available: result.available, diagnostics: result.diagnostic ? [result.diagnostic] : [] };
  }
  if ("allOf" in expr) {
    const results = expr.allOf!.map((e) => evaluateExpression(e, ctx));
    const allAvailable = results.every((r) => r.available);
    return { available: allAvailable, diagnostics: results.flatMap((r) => r.diagnostics) };
  }
  if ("anyOf" in expr) {
    const results = expr.anyOf!.map((e) => evaluateExpression(e, ctx));
    const anyAvailable = results.some((r) => r.available);
    return { available: anyAvailable, diagnostics: results.flatMap((r) => r.diagnostics) };
  }
  return { available: false, diagnostics: [{ reason: "unknown-signal", message: "unknown expression" }] };
}

export function buildToolPlan(
  descriptors: readonly ToolDescriptor[],
  ctx: ToolAvailabilityContext,
): ToolPlan {
  const visible: ToolPlanEntry[] = [];
  const hidden: HiddenToolPlanEntry[] = [];

  for (const desc of descriptors) {
    if (!desc.availability) {
      if (desc.executor) visible.push({ descriptor: desc, executor: desc.executor });
      continue;
    }
    const result = evaluateExpression(desc.availability, ctx);
    if (result.available && desc.executor) {
      visible.push({ descriptor: desc, executor: desc.executor });
    } else if (!result.available) {
      hidden.push({ descriptor: desc, diagnostics: result.diagnostics });
    }
  }

  visible.sort((a, b) => (a.descriptor.sortKey ?? a.descriptor.name).localeCompare(b.descriptor.sortKey ?? b.descriptor.name));
  return { visible, hidden };
}
