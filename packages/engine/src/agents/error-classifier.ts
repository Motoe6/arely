import type { ExecutionErrorKind } from "./execution-contract.js";
import { TimeoutError, CancelledError } from "../tools/errors.js";
import { PipelineToolError } from "./pipeline-tool-executor.js";

export function classifyExecutionError(err: unknown): ExecutionErrorKind {
  if (typeof err === "string") {
    if (/[Pp]ermission/.test(err)) return "permission";
    if (/[Vv]alidat/.test(err)) return "validation";
    if (/[Dd]epend/.test(err)) return "dependency_failed";
    if (/[Tt]ime(d\s*)?out/.test(err)) return "timeout";
    if (/[Cc]ancelled/.test(err)) return "cancelled";
    if (/[Tt]ool\b/.test(err)) return "tool_error";
    return "internal";
  }

  if (err instanceof TimeoutError) return "timeout";
  if (err instanceof CancelledError) return "cancelled";
  if (err instanceof PipelineToolError) return "tool_error";

  const msg = err instanceof Error ? err.message : String(err);
  if (/[Pp]ermission/.test(msg)) return "permission";
  if (/[Vv]alidat/.test(msg)) return "validation";
  if (/[Dd]epend/.test(msg)) return "dependency_failed";

  return "internal";
}
