import * as vm from "node:vm";

export interface ExpressionContext {
  $json?: Record<string, unknown>;
  $params?: Record<string, unknown>;
  $env?: Record<string, string | undefined>;
  $vars?: Record<string, unknown>;
  $items?: unknown[];
  $node?: Record<string, { context: Record<string, unknown> }>;
  $execution?: { id: string; mode: string };
  $workflow?: { id: string; name: string };
  [key: string]: unknown;
}

const RESERVED_VARS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "arguments",
  "caller",
  "callee",
  "require",
  "import",
  "eval",
  "Function",
  "asyncFunction",
  "Proxy",
  "global",
  "globalThis",
  "process",
  "Buffer",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "fetch",
  "WebSocket",
  "EventSource",
]);

export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly cause?: unknown,
  ) {
    super(`ExpressionError: ${message}`);
    this.name = "ExpressionError";
  }
}

function sanitizeCode(code: string, allowedVars: string[]): string {
  const allowed = new Set([...allowedVars, ...RESERVED_VARS]);
  const varPattern = /\b(?:constructor|__proto__|prototype|require|import|eval|Function|Proxy|global|globalThis|process|Buffer)\b/g;
  if (varPattern.test(code)) {
    throw new ExpressionError("Expression uses blocked reserved identifiers", code);
  }

  if (/new\s+(?!Date|Map|Set|Array|Object|RegExp|Error|Promise|Number|String|Boolean)/.test(code)) {
    throw new ExpressionError("Expression uses blocked constructor", code);
  }

  return code;
}

function buildSandbox(ctx: ExpressionContext): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    $: ctx,
    Date,
    Map,
    Set,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    decodeURI,
    encodeURI,
    decodeURIComponent,
    encodeURIComponent,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  for (const [key, value] of Object.entries(ctx)) {
    if (!RESERVED_VARS.has(key) && !(key in sandbox)) {
      sandbox[key] = value;
    }
  }

  return sandbox;
}

const EXPRESSION_RE = /\{\{(.+?)\}\}/g;

export function hasExpressions(template: string): boolean {
  return EXPRESSION_RE.test(template);
}

export function resolveExpression(
  expression: string,
  context: ExpressionContext,
): unknown {
  const code = expression.trim();

  if (!code) return "";

  const allowedVars = Object.keys(context);
  const sanitized = sanitizeCode(code, allowedVars);
  const sandbox = buildSandbox(context);

  const script = new vm.Script(`(${sanitized})`, {
    filename: "expression.js",
  });

  try {
    const result = script.runInNewContext(sandbox, {
      timeout: 1000,
      breakOnSigint: true,
    } as vm.RunningScriptOptions);
    return result;
  } catch (err) {
    throw new ExpressionError(
      `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      expression,
      err,
    );
  }
}

export function renderTemplate(
  template: string,
  context: ExpressionContext,
): string {
  return template.replace(EXPRESSION_RE, (_match, expression) => {
    try {
      const result = resolveExpression(expression, context);
      if (result === null || result === undefined) return "";
      return String(result);
    } catch {
      return "";
    }
  });
}

export function renderTemplateStrict(
  template: string,
  context: ExpressionContext,
): string {
  return template.replace(EXPRESSION_RE, (_match, expression) => {
    const result = resolveExpression(expression, context);
    if (result === null || result === undefined) {
      throw new ExpressionError(
        `Expression resolved to null/undefined`,
        expression,
      );
    }
    return String(result);
  });
}
