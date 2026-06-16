import type { RpcMessage } from "./types.js";

export type MessageHandler = (msg: RpcMessage) => void;

export interface RpcTransport {
  send(msg: RpcMessage): void;
  onMessage(handler: MessageHandler): void;
  close(): void;
  isConnected(): boolean;
}

// ── Server-side transport (for Coordinator) ──

export class CoordinatorRpcServer {
  private connections = new Map<string, RpcTransport>();
  private handlers: MessageHandler[] = [];
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  registerConnection(workerId: string, transport: RpcTransport): void {
    this.connections.set(workerId, transport);
    transport.onMessage((msg) => {
      for (const h of this.handlers) h(msg);
    });
    this.log(`RPC connection registered for worker ${workerId}`);
  }

  removeConnection(workerId: string): void {
    const transport = this.connections.get(workerId);
    if (transport) {
      transport.close();
      this.connections.delete(workerId);
    }
  }

  sendTo(workerId: string, msg: RpcMessage): boolean {
    const transport = this.connections.get(workerId);
    if (transport && transport.isConnected()) {
      transport.send(msg);
      return true;
    }
    return false;
  }

  broadcast(msg: RpcMessage): void {
    for (const [id, transport] of this.connections) {
      if (transport.isConnected()) {
        transport.send(msg);
      } else {
        this.connections.delete(id);
      }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  closeAll(): void {
    for (const [id, transport] of this.connections) {
      transport.close();
    }
    this.connections.clear();
  }

  getConnectedWorkerIds(): string[] {
    return [...this.connections.keys()].filter((id) => this.connections.get(id)?.isConnected());
  }

  getConnectionCount(): number {
    return this.getConnectedWorkerIds().length;
  }
}

// ── Simple in-process transport (for localhost testing) ──

export function createInProcessTransport(
  sendToPeer: (msg: RpcMessage) => void,
  log?: (msg: string) => void,
): RpcTransport {
  const peerHandlers: MessageHandler[] = [];
  let connected = true;

  return {
    send(msg: RpcMessage): void {
      try {
        sendToPeer(msg);
      } catch (err) {
        log?.(`RPC send error: ${err}`);
      }
    },

    onMessage(handler: MessageHandler): void {
      peerHandlers.push(handler);
    },

    close(): void {
      connected = false;
      peerHandlers.length = 0;
    },

    isConnected(): boolean {
      return connected;
    },
  };
}

export function connectInProcess(
  a: CoordinatorRpcServer,
  workerId: string,
): RpcTransport {
  const transport: RpcTransport = {
    send(msg: RpcMessage): void {
      for (const h of a["handlers"] as MessageHandler[]) {
        try { h(msg); } catch { /* ignore */ }
      }
    },
    onMessage(handler: MessageHandler): void {
      (a["handlers"] as MessageHandler[]).push(handler);
    },
    close(): void {
      /* in-process: no-op */
    },
    isConnected(): boolean {
      return true;
    },
  };
  a.registerConnection(workerId, transport);
  return transport;
}
