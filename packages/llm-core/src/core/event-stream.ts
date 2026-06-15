import type { AssistantMessage, AssistantMessageEvent } from "./types.js";

export class AssistantMessageEventStreamImpl implements AsyncIterable<AssistantMessageEvent> {
  private _done = false;
  private _result: AssistantMessage | undefined;
  private _resolveResult!: (msg: AssistantMessage) => void;
  private _resultPromise: Promise<AssistantMessage>;
  private _buffer: AssistantMessageEvent[] = [];
  private _consumers: ((event: AssistantMessageEvent) => void)[] = [];

  constructor() {
    this._resultPromise = new Promise<AssistantMessage>((resolve) => {
      this._resolveResult = resolve;
    });
  }

  push(event: AssistantMessageEvent): void {
    if (this._done) return;
    for (const c of this._consumers) c(event);
    this._buffer.push(event);
  }

  end(result?: AssistantMessage): void {
    if (this._done) return;
    this._done = true;
    if (result) {
      this._result = result;
      this._resolveResult(result);
    }
    for (const c of this._consumers) c({ type: "done" as any, reason: "stop" as any, message: result! });
  }

  result(): Promise<AssistantMessage> {
    return this._resultPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    let idx = 0;
    let done = false;
    const stream = this;
    return {
      next(): Promise<IteratorResult<AssistantMessageEvent>> {
        if (idx < stream._buffer.length) {
          return Promise.resolve({ value: stream._buffer[idx++], done: false });
        }
        if (stream._done) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise((resolve) => {
          stream._consumers.push((event) => {
            if (idx < stream._buffer.length) {
              resolve({ value: stream._buffer[idx++], done: false });
            }
          });
          if (stream._done && idx >= stream._buffer.length) {
            resolve({ value: undefined as any, done: true });
          }
        });
      },
    };
  }
}
