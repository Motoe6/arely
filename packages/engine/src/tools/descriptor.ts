export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type ToolOwnerRef =
  | { readonly kind: "core" }
  | { readonly kind: "plugin"; readonly pluginId: string };

export type ToolExecutorRef =
  | { readonly kind: "core"; readonly executorId: string }
  | { readonly kind: "plugin"; readonly pluginId: string; readonly toolName: string };

export type ToolAvailabilitySignal =
  | { readonly kind: "always" }
  | { readonly kind: "auth"; readonly providerId: string }
  | { readonly kind: "config"; readonly path: readonly string[]; readonly check?: "exists" | "non-empty" }
  | { readonly kind: "env"; readonly name: string }
  | { readonly kind: "plugin-enabled"; readonly pluginId: string };

export type ToolAvailabilityExpression =
  | ToolAvailabilitySignal
  | { readonly allOf: readonly ToolAvailabilityExpression[] }
  | { readonly anyOf: readonly ToolAvailabilityExpression[] };

export type ToolDescriptor = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly owner: ToolOwnerRef;
  readonly executor?: ToolExecutorRef;
  readonly availability?: ToolAvailabilityExpression;
  readonly sortKey?: string;
};

export type ToolAvailabilityContext = {
  readonly config?: JsonObject;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly enabledPluginIds?: ReadonlySet<string>;
};

export type ToolUnavailableReason =
  | "config-missing"
  | "env-missing"
  | "plugin-disabled"
  | "auth-missing"
  | "unknown-signal";

export type ToolAvailabilityDiagnostic = {
  readonly reason: ToolUnavailableReason;
  readonly message: string;
};

export type ToolPlanEntry = {
  readonly descriptor: ToolDescriptor;
  readonly executor: ToolExecutorRef;
};

export type HiddenToolPlanEntry = {
  readonly descriptor: ToolDescriptor;
  readonly diagnostics: readonly ToolAvailabilityDiagnostic[];
};

export type ToolPlan = {
  readonly visible: readonly ToolPlanEntry[];
  readonly hidden: readonly HiddenToolPlanEntry[];
};
