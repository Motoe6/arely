import { WebSocketServer, WebSocket } from "ws";
import type { RpcMessage } from "./types.js";

export type MessageHandler = (msg: RpcMessage) => void;

export interface RpcTransport {
  send(msg: RpcMessage): void;
  onMessage(handler: MessageHandler): void;
  close(): void;
  isConnected(): boolean;
}

// ── Coordinator-side: WebSocket server ──

export class WebSocketRpcServer {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocket>();
  private handlers: MessageHandler[] = [];
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  start(port: number): void {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws, req) => {
      const workerId = this.extractWorkerId(req.url ?? "");
      if (!workerId) {
        ws.close(4000, "missing workerId");
        return;
      }

      this.log(`WebSocket connection from worker ${workerId}`);
      this.connections.set(workerId, ws);

      ws.on("message", (raw) => {
        try {
          const msg: RpcMessage = JSON.parse(raw.toString());
          for (const h of this.handlers) h(msg);
        } catch (err) {
          this.log(`Invalid message from ${workerId}: ${err}`);
        }
      });

      ws.on("close", () => {
        this.log(`Worker ${workerId} disconnected`);
        this.connections.delete(workerId);
      });

      ws.on("error", (err) => {
        this.log(`WebSocket error for ${workerId}: ${err}`);
        this.connections.delete(workerId);
      });
    });
    this.log(`WebSocketRpcServer listening on port ${port}`);
  }

  stop(): void {
    if (this.wss) {
      for (const [, ws] of this.connections) {
        try { ws.close(); } catch { /* ignore */ }
      }
      this.connections.clear();
      this.wss.close();
      this.wss = null;
    }
  }

  sendTo(workerId: string, msg: RpcMessage): boolean {
    const ws = this.connections.get(workerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  broadcast(msg: RpcMessage): void {
    const data = JSON.stringify(msg);
    for (const [id, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        this.connections.delete(id);
      }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  getConnectedWorkerIds(): string[] {
    return [...this.connections.keys()];
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  private extractWorkerId(url: string): string | null {
    try {
      const u = new URL(url, "http://localhost");
      return u.searchParams.get("workerId");
    } catch {
      return null;
    }
  }
}

// ── Worker-side: WebSocket client ──

export class WebSocketRpcClient implements RpcTransport {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private coordinatorUrl: string;
  private workerId: string;
  private log: (msg: string) => void;
  private reconnectTimer: ReturnType<typeof setInterval> | undefined;
  private _connected = false;
  private sendBuffer: RpcMessage[] = [];

  constructor(coordinatorUrl: string, workerId: string, log?: (msg: string) => void) {
    this.coordinatorUrl = coordinatorUrl;
    this.workerId = workerId;
    this.log = log ?? (() => {});
  }

  connect(): void {
    const url = `${this.coordinatorUrl}?workerId=${this.workerId}`;
    this.log(`Connecting to coordinator at ${url}`);
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this._connected = true;
      this.log(`Connected to coordinator`);
      // Flush buffered messages
      for (const msg of this.sendBuffer) {
        this.ws!.send(JSON.stringify(msg));
      }
      this.sendBuffer.length = 0;
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    });

    this.ws.on("message", (raw) => {
      try {
        const msg: RpcMessage = JSON.parse(raw.toString());
        for (const h of this.handlers) h(msg);
      } catch (err) {
        this.log(`Invalid message: ${err}`);
      }
    });

    this.ws.on("close", () => {
      this._connected = false;
      this.log(`Disconnected from coordinator`);
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      this.log(`WebSocket error: ${err}`);
      this._connected = false;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      this.log(`Attempting reconnect...`);
      this.connect();
    }, 5000);
  }

  send(msg: RpcMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Buffer for when connection opens
      this.sendBuffer.push(msg);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  close(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.sendBuffer.length = 0;
  }

  isConnected(): boolean {
    return this._connected;
  }
}

// ── In-process transport (for localhost testing) ──

export class InProcessRpcServer {
  private connections = new Map<string, InProcessRpcClientTransport>();
  private handlers: MessageHandler[] = [];
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  registerConnection(workerId: string, transport: InProcessRpcClientTransport): void {
    this.connections.set(workerId, transport);
    transport.setServerHandler((msg) => {
      for (const h of this.handlers) h(msg);
    });
  }

  removeConnection(workerId: string): void {
    this.connections.delete(workerId);
  }

  sendTo(workerId: string, msg: RpcMessage): boolean {
    const transport = this.connections.get(workerId);
    if (transport && transport.isConnected()) {
      transport.receive(msg);
      return true;
    }
    return false;
  }

  broadcast(msg: RpcMessage): void {
    for (const [id, t] of this.connections) {
      if (t.isConnected()) t.receive(msg);
      else this.connections.delete(id);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  closeAll(): void {
    for (const [, t] of this.connections) t.close();
    this.connections.clear();
  }

  getConnectedWorkerIds(): string[] {
    return [...this.connections.keys()];
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

export class InProcessRpcClientTransport implements RpcTransport {
  private serverHandler: MessageHandler | null = null;
  private clientHandlers: MessageHandler[] = [];
  private _connected = true;

  setServerHandler(handler: MessageHandler): void {
    this.serverHandler = handler;
  }

  receive(msg: RpcMessage): void {
    for (const h of this.clientHandlers) h(msg);
  }

  send(msg: RpcMessage): void {
    if (this.serverHandler) {
      this.serverHandler(msg);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.clientHandlers.push(handler);
  }

  close(): void {
    this._connected = false;
    this.clientHandlers.length = 0;
    this.serverHandler = null;
  }

  isConnected(): boolean {
    return this._connected;
  }
}
