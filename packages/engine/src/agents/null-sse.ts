import { SSEBus } from "../server/sse.js";

export class NullSSEBus extends SSEBus {
  emit(): void {
    /* no-op */
  }
  on(): () => void {
    return () => undefined;
  }
  off(): void {
    /* no-op */
  }
  addClient(): void {
    /* no-op */
  }
  removeAllClients(): void {
    /* no-op */
  }
  getSequence(): number {
    return 0;
  }
}
