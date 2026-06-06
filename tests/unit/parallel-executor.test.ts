import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParallelExecutor } from "@opencode/engine/tools/parallel-executor.js";

function delayed(value: string, ms: number) {
  return () => new Promise<string>((resolve) => setTimeout(() => resolve(value), ms));
}

function failing(msg: string) {
  return () => Promise.reject(new Error(msg));
}

describe("ParallelExecutor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("executes all tasks and returns results in order", async () => {
    const exec = new ParallelExecutor({ concurrency: 2 });
    const tasks = [
      { execute: delayed("a", 10) },
      { execute: delayed("b", 5) },
    ];
    const promise = exec.runAll(tasks);
    await vi.runAllTimersAsync();
    const results = await promise;
    expect(results).toEqual(["a", "b"]);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const exec = new ParallelExecutor({ concurrency: 2 });
    const makeTask = (ms: number) => ({
      execute: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, ms));
        concurrent--;
        return "ok";
      },
    });
    const tasks = [makeTask(10), makeTask(10), makeTask(10), makeTask(10)];
    const promise = exec.runAll(tasks);
    await vi.runAllTimersAsync();
    await promise;
    expect(maxConcurrent).toBe(2);
  });

  it("rejects on task failure", async () => {
    const exec = new ParallelExecutor({ concurrency: 3 });
    const tasks = [
      { execute: async () => "a" },
      { execute: async () => { throw new Error("fail"); } },
    ];
    await expect(exec.runAll(tasks)).rejects.toThrow("fail");
  });

  it("handles pre-aborted signal", async () => {
    const exec = new ParallelExecutor({ concurrency: 2 });
    const controller = new AbortController();
    controller.abort();
    const tasks = [
      { execute: () => Promise.resolve("a") },
    ];
    await expect(exec.runAll(tasks, controller.signal)).rejects.toThrow("Parallel execution cancelled");
  });

  it("applies per-task timeout", async () => {
    vi.useRealTimers();
    const exec = new ParallelExecutor({ concurrency: 2, defaultTimeoutMs: 10 });
    const tasks = [
      { execute: () => new Promise<string>(() => {}) },
    ];
    await expect(exec.runAll(tasks)).rejects.toThrow("timed out");
  });

  it("returns empty for no tasks", async () => {
    const exec = new ParallelExecutor({ concurrency: 2 });
    const results = await exec.runAll([]);
    expect(results).toEqual([]);
  });
});
