import type { IncomingMessage, ServerResponse } from "node:http";
import { ulid } from "ulid";
import { runWithContext, type RequestContext } from "./request-context.js";
import { logger } from "../logger.js";

const MAX_BODY_BYTES = 1_048_576;

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export interface RequestCounter {
  middleware: Middleware;
  active(): number;
}

export function requestId(): Middleware {
  return (req, res, next) => {
    const id = ulid();
    (req as unknown as Record<string, unknown>).requestId = id;
    (res as unknown as Record<string, unknown>).locals = { requestId: id };
    res.setHeader("x-request-id", id);
    next();
  };
}

export function cors(origin = "*"): Middleware {
  return (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-request-id");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    next();
  };
}

export function auth(apiKey: string | undefined, exclude: string[] = []): Middleware {
  return (req, res, next) => {
    if (!apiKey) return next();
    const url = new URL(req.url ?? "/", "http://localhost");
    if (exclude.some((p) => url.pathname.startsWith(p))) return next();
    const header = req.headers["x-api-key"] as string | undefined;
    if (header === apiKey) return next();
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  };
}

export function bodyParser(limit = MAX_BODY_BYTES, exclude: string[] = []): Middleware {
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (exclude.some((p) => url.pathname.startsWith(p))) return next();
    if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return next();

    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > limit) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Request body too large" }));
      return;
    }

    let body = "";
    let bodyBytes = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      bodyBytes += chunk.length;
      if (bodyBytes > limit) {
        aborted = true;
        req.destroy();
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Request body too large" }));
        return;
      }
      body += chunk.toString("utf-8");
    });

    req.on("end", () => {
      if (aborted) return;
      if (body.length > 0) {
        try {
          (req as unknown as Record<string, unknown>).body = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON in request body" }));
          return;
        }
      }
      next();
    });
  };
}

export function requestCounter(): RequestCounter {
  let active = 0;
  return {
    middleware(_req, res, next) {
      active++;
      res.on("close", () => {
        active--;
      });
      next();
    },
    active() {
      return active;
    },
  };
}

export function requestLogger(opts: { exclude?: string[] } = {}): Middleware {
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (opts.exclude?.some((p) => url.pathname.startsWith(p))) return next();

    const start = Date.now();
    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<ServerResponse["end"]>) {
      const duration = Date.now() - start;
      const rid = ((res as unknown as Record<string, unknown>).locals as Record<string, unknown>)?.requestId as string | undefined;
      logger.info("http", `${req.method} ${url.pathname} ${res.statusCode} ${duration}ms`, {
        correlationId: rid,
        metadata: { method: req.method, path: url.pathname, status: res.statusCode, durationMs: duration },
      });
      return originalEnd(...args);
    } as ServerResponse["end"];
    next();
  };
}

export function errorHandler(): Middleware {
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      next();
    } catch (err) {
      const rid = ((res as unknown as Record<string, unknown>).locals as Record<string, unknown>)?.requestId as string | undefined;
      const status = url.pathname.startsWith("/api/") ? 500 : 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), requestId: rid }));
    }
  };
}

export function requestContext(): Middleware {
  return (req, res, next) => {
    const rid = ((res as unknown as Record<string, unknown>).locals as Record<string, unknown>)?.requestId as string | undefined;
    const ctx: RequestContext = { requestId: rid ?? "", startTime: Date.now() };
    runWithContext(ctx, next);
  };
}
