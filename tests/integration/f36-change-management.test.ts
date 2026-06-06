import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHttpServer } from "@opencode/engine/transport/http-server.js";
import { SSEBus } from "@opencode/engine/server/sse.js";
import { loadConfig } from "@opencode/engine/config/index.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

function rawBodyParser(): Middleware {
  return (req, _res, next) => {
    if (req.method !== "POST" && req.method !== "PUT") return next();
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString("utf-8"); });
    req.on("end", () => {
      (req as unknown as Record<string, unknown>).body = body;
      next();
    });
  };
}

const tmpDir = join(tmpdir(), "f36-integration-test");
const sse = new SSEBus();

function postJson(url: string, body: unknown): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const opts: http.RequestOptions = {
      hostname: u.hostname,
      port: Number(u.port),
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ statusCode: res.statusCode ?? 0, data: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode ?? 0, data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function getJson(url: string): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ statusCode: res.statusCode ?? 0, data: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode ?? 0, data }); }
      });
    }).on("error", reject);
  });
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" ? addr!.port : 0);
    });
  });
}

let baseUrl: string;
let server: http.Server;

const sampleRule: PolicyRule = {
  id: "int-rule-1",
  name: "Integration Rule",
  description: "For F36 integration test",
  metric: "latency",
  operator: "gt" as const,
  threshold: 200,
  severity: "high" as const,
  action: "log" as const,
  enabled: true,
};

describe("F36 HTTP /control/change/*", () => {
  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key";
    process.env.POLICY_PACKS_DIR = tmpDir;
    process.env.OPENCODE_POLICY_PACKS_DIR = tmpDir;
    loadConfig();
    initTestDb();
    mkdirSync(tmpDir, { recursive: true });
    const pack = {
      id: "f36-test-pack",
      name: "F36 Test Pack",
      description: "A pack for integration tests",
      rules: [sampleRule],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(tmpDir, "f36-test-pack.json"), JSON.stringify(pack));
    server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
  });

  afterAll(async () => {
    cleanupTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OPENCODE_POLICY_PACKS_DIR;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("POST /control/change/create — creates a draft change", async () => {
    const port = await listenOnRandomPort(server);
    baseUrl = `http://localhost:${port}`;
    const { statusCode, data } = await postJson(`${baseUrl}/control/change/create`, {
      packId: "f36-test-pack",
      rules: [],
      recommendationIds: ["int-rec-1"],
    });
    expect(statusCode).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe("draft");
    expect(d.packId).toBe("f36-test-pack");
  });

  it("POST /control/change/create — 400 on missing packId", async () => {
    const { statusCode } = await postJson(`${baseUrl}/control/change/create`, { rules: [] });
    expect(statusCode).toBe(400);
  });

  it("POST /control/change/create — 404 on nonexistent pack", async () => {
    const { statusCode } = await postJson(`${baseUrl}/control/change/create`, {
      packId: "no-such-pack",
      rules: [],
    });
    expect(statusCode).toBe(404);
  });

  it("POST /control/change/:id/approve — approves a draft change", async () => {
    const { data: created } = await postJson(`${baseUrl}/control/change/create`, {
      packId: "f36-test-pack",
      rules: [sampleRule],
    });
    const id = (created as Record<string, unknown>).id as string;
    const { statusCode, data } = await postJson(`${baseUrl}/control/change/${id}/approve`, {});
    expect(statusCode).toBe(200);
    expect((data as Record<string, unknown>).status).toBe("approved");
  });

  it("POST /control/change/:id/approve — 404 on unknown id", async () => {
    const { statusCode } = await postJson(`${baseUrl}/control/change/no-such-id/approve`, {});
    expect(statusCode).toBe(404);
  });

  it("POST /control/change/:id/apply — applies an approved change", async () => {
    const { data: created } = await postJson(`${baseUrl}/control/change/create`, {
      packId: "f36-test-pack",
      rules: [sampleRule],
    });
    const id = (created as Record<string, unknown>).id as string;
    await postJson(`${baseUrl}/control/change/${id}/approve`, {});
    const { statusCode, data } = await postJson(`${baseUrl}/control/change/${id}/apply`, {});
    expect(statusCode).toBe(200);
    expect((data as Record<string, unknown>).status).toBe("applied");
  });

  it("POST /control/change/:id/apply — 404 on unknown id", async () => {
    const { statusCode } = await postJson(`${baseUrl}/control/change/no-such-id/apply`, {});
    expect(statusCode).toBe(404);
  });

  it("GET /control/change/:id — returns a change", async () => {
    const { data: created } = await postJson(`${baseUrl}/control/change/create`, {
      packId: "f36-test-pack",
      rules: [sampleRule],
    });
    const id = (created as Record<string, unknown>).id as string;
    const { statusCode, data } = await getJson(`${baseUrl}/control/change/${id}`);
    expect(statusCode).toBe(200);
    expect((data as Record<string, unknown>).id).toBe(id);
  });

  it("GET /control/change/:id — 404 on unknown id", async () => {
    const { statusCode } = await getJson(`${baseUrl}/control/change/no-such-id`);
    expect(statusCode).toBe(404);
  });

  it("GET /control/changes — lists changes", async () => {
    const { statusCode, data } = await getJson(`${baseUrl}/control/changes`);
    expect(statusCode).toBe(200);
    const d = data as { changes: unknown[] };
    expect(Array.isArray(d.changes)).toBe(true);
    expect(d.changes.length).toBeGreaterThan(0);
  });
});
