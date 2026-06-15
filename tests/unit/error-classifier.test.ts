import { describe, it, expect } from "vitest";
import { classifyExecutionError } from "@arely/engine/agents/error-classifier.js";
import { TimeoutError, CancelledError } from "@arely/engine/tools/errors.js";
import { PipelineToolError } from "@arely/engine/agents/pipeline-tool-executor.js";

describe("classifyExecutionError", () => {
  it("classifies TimeoutError instance as timeout", () => {
    expect(classifyExecutionError(new TimeoutError("timed out"))).toBe("timeout");
  });

  it("classifies CancelledError instance as cancelled", () => {
    expect(classifyExecutionError(new CancelledError("cancelled"))).toBe("cancelled");
  });

  it("classifies PipelineToolError instance as tool_error", () => {
    expect(classifyExecutionError(new PipelineToolError("tool rejected"))).toBe("tool_error");
  });

  it("classifies string containing 'timeout' as timeout", () => {
    expect(classifyExecutionError("Operation timed out after 10000ms")).toBe("timeout");
  });

  it("classifies string containing 'cancelled' as cancelled", () => {
    expect(classifyExecutionError("The operation was cancelled")).toBe("cancelled");
  });

  it("classifies string containing 'permission' as permission", () => {
    expect(classifyExecutionError("Permission denied")).toBe("permission");
  });

  it("classifies string containing 'validat' as validation", () => {
    expect(classifyExecutionError("Validation failed: timeoutMs must be > 0")).toBe("validation");
  });

  it("classifies string containing 'depend' as dependency_failed", () => {
    expect(classifyExecutionError("Dependency step not found")).toBe("dependency_failed");
  });

  it("classifies unknown string as internal", () => {
    expect(classifyExecutionError("database corruption")).toBe("internal");
  });

  it("classifies fallback Error as internal", () => {
    expect(classifyExecutionError(new Error("something broke"))).toBe("internal");
  });

  it("classifies Error with permission message as permission", () => {
    expect(classifyExecutionError(new Error("Permission denied: no access"))).toBe("permission");
  });

  it("classifies null as internal", () => {
    expect(classifyExecutionError(null)).toBe("internal");
  });
});
