import { describe, it, expect } from "vitest";
import { Router } from "@arelyos/engine/transport/router.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

function createMockReq(url: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = { host: "localhost" };
  return req;
}

function createMockRes() {
  const result = { body: "", status: 200 };
  const socket = new Socket();
  const res = new ServerResponse(socket);
  res.writeHead = (statusCode: number) => {
    result.status = statusCode;
    return res;
  };
  res.end = (data?: unknown) => {
    result.body = data as string;
    return res;
  };
  return { res, result };
}

describe("Router", () => {
  it("should dispatch GET to matching handler", () => {
    const router = new Router();
    router.get("/test", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const req = createMockReq("/test");
    const { res, result } = createMockRes();
    router.dispatch(req, res);

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });

  it("should return 404 for unknown routes", () => {
    const router = new Router();
    const req = createMockReq("/unknown");
    const { res, result } = createMockRes();
    router.dispatch(req, res);

    expect(result.status).toBe(404);
  });

  it("should handle route parameters", () => {
    const router = new Router();
    const captured: Record<string, string> = {};

    router.get("/users/:id", (_req, res, params) => {
      captured.id = params.id;
      res.writeHead(200);
      res.end();
    });

    const req = createMockReq("/users/42");
    const { res } = createMockRes();
    router.dispatch(req, res);

    expect(captured.id).toBe("42");
  });

  it("should handle POST routes", () => {
    const router = new Router();
    let posted = false;

    router.post("/api/data", (_req, res) => {
      posted = true;
      res.writeHead(201);
      res.end();
    });

    const req = createMockReq("/api/data", "POST");
    const { res } = createMockRes();
    router.dispatch(req, res);

    expect(posted).toBe(true);
  });

  it("should return 500 on handler error", () => {
    const router = new Router();
    router.get("/error", () => {
      throw new Error("handler failed");
    });

    const req = createMockReq("/error");
    const { res, result } = createMockRes();
    router.dispatch(req, res);

    expect(result.status).toBe(500);
    expect(result.body).toContain('"error"');
  });
});
