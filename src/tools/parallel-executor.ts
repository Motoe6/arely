import { withTimeout } from "./errors.js";

export interface Task<T> {
  execute(): Promise<T>;
  label?: string;
}

export interface ParallelExecutorOptions {
  concurrency: number;
  defaultTimeoutMs?: number;
}

export class ParallelExecutor {
  private readonly concurrency: number;
  private readonly defaultTimeoutMs?: number;

  constructor(options: ParallelExecutorOptions) {
    this.concurrency = options.concurrency;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
  }

  async runAll<T>(tasks: Task<T>[], signal?: AbortSignal): Promise<T[]> {
    const results: T[] = [];
    let index = 0;

    const worker = async (
      self: ParallelExecutor,
      resolve: (value: T[]) => void,
      reject: (err: unknown) => void,
    ): Promise<void> => {
      while (index < tasks.length) {
        if (signal?.aborted) {
          reject(new Error("Parallel execution cancelled"));
          return;
        }

        const i = index++;
        const task = tasks[i];

        try {
          let promise = task.execute();
          if (self.defaultTimeoutMs !== undefined) {
            promise = withTimeout(promise, self.defaultTimeoutMs);
          }
          const result = await promise;
          results[i] = result;
        } catch (err) {
          reject(err);
          return;
        }
      }

      if (results.filter((r) => r !== undefined).length === tasks.length) {
        resolve(results);
      }
    }

    return new Promise<T[]>((resolve, reject) => {
      const workers = Math.min(this.concurrency, tasks.length);
      if (workers === 0) {
        resolve([]);
        return;
      }
      for (let w = 0; w < workers; w++) {
        void worker(this, resolve, reject);
      }
    });
  }
}
