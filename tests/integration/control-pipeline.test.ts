import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHttpServer } from "@arely/engine/transport/http-server.js";
import { SSEBus } from "@arely/engine/server/sse.js";
import { loadConfig } from "@arely/engine/config/index.js";
import { insertEvent } from "@arely/engine/persistence/policy-audit-store.js";
import type { PolicyRule } from "@arely/engine/agents/policy/policy-types.js";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

function rawBodyParser(): Middleware {
  return (req, _res, next) => {
    if (req.method !== "POST") return next();
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString("utf-8"); });
    req.on("end", () => {
      (req as unknown as Record<string, unknown>).body = body;
      next();
    });
  };
}

const tmpDir = join(tmpdir(), "control-pipeline-test");
const sse = new SSEBus();

function makeRule(id: string, when: Partial<PolicyRule["when"]> = {}): PolicyRule {
  return { id, when, then: { type: "trigger_remediation", payload: {} }, cooldownMs: 60000, maxExecutionsPerHour: 10 };
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" ? addr!.port : 0);
    });
  });
}

async function postUrl(url: string, data: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const req = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json).toString() },
    }, (res) => {
      let body = "";
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on("error", (err: Error) => reject(err));
    req.write(json);
    req.end();
  });
}

describe("M10.1 POST /control/pipeline", () => {
  beforeAll(() => {
    initTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    process.env.ARELY_API_KEY = "test-key";
    process.env.ARELY_POLICY_PACKS_DIR = tmpDir;
    loadConfig();

    // Seed audit traces
    insertEvent("trace-a", "cycle_started", {
      metrics: { successRate: 0.85, retryRate: 0.05 },
      circuitBreakerStates: {},
      actions: [{ ruleId: "high_success", action: "trigger_remediation", payload: {} }],
    });
    insertEvent("trace-b", "cycle_started", {
      metrics: { successRate: 0.95, retryRate: 0.02 },
      circuitBreakerStates: {},
      actions: [],
    });
    insertEvent("trace-c", "cycle_started", {
      metrics: { successRate: 0.78, retryRate: 0.12 },
      circuitBreakerStates: {},
      actions: [{ ruleId: "high_success", action: "trigger_remediation", payload: {} }],
    });
  });

  afterAll(() => {
    cleanupTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs full pipeline: simulation + recommendations + impact reports + meta", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const rules: PolicyRule[] = [
      makeRule("high_success", { successRate: { lt: 0.9 } }),
      makeRule("never_hit", { successRate: { lt: 0 } }),
    ];
    const createRes = await postUrl(`http://localhost:${port}/packs`, { name: "full-pipeline", description: "", rules });
    const pack = JSON.parse(createRes.body);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/pipeline`, { packId: pack.id });
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.packId).toBe(pack.id);
    expect(data.pack.name).toBe("full-pipeline");
    expect(data.pack.rules).toBe(2);

    // Simulation block
    expect(data.simulation).toBeDefined();
    expect(data.simulation.tracesRequested).toBeGreaterThanOrEqual(1);
    expect(data.simulation.tracesSucceeded).toBeGreaterThanOrEqual(1);
    expect(typeof data.simulation.overallMatchRate).toBe("number");

    // Recommendations block
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);

    // Impact reports block
    expect(Array.isArray(data.impactReports)).toBe(true);
    expect(data.impactReports).toHaveLength(data.recommendations.length);

    // Meta block
    expect(data.meta).toBeDefined();
    expect(data.meta.tracesRequested).toBe(data.simulation.tracesRequested);
    expect(data.meta.tracesSucceeded).toBe(data.simulation.tracesSucceeded);
    expect(data.meta.tracesFailed).toBe(data.simulation.tracesFailed);
    expect(typeof data.meta.generatedAt).toBe("string");
    expect(typeof data.meta.durationMs).toBe("number");
    server.close();
  });

  it("returns 400 when packId is missing", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/pipeline`, {});
    expect(statusCode).toBe(400);
    const data = JSON.parse(body);
    expect(data.error).toBe("packId is required");
    server.close();
  });

  it("returns 404 for nonexistent pack", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/pipeline`, { packId: "nonexistent-pack" });
    expect(statusCode).toBe(404);
    const data = JSON.parse(body);
    expect(data.error).toContain("nonexistent-pack");
    server.close();
  });

  it("processes only the requested traceIds when explicitly provided", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const rules: PolicyRule[] = [
      makeRule("high_success", { successRate: { lt: 0.9 } }),
    ];
    const createRes = await postUrl(`http://localhost:${port}/packs`, { name: "explicit-pipeline", description: "", rules });
    const pack = JSON.parse(createRes.body);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/pipeline`, {
      packId: pack.id,
      traceIds: ["trace-a", "trace-b"],
    });
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.meta.tracesRequested).toBe(2);
    expect(data.meta.tracesSucceeded).toBe(2);
    expect(data.meta.tracesFailed).toBe(0);
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(Array.isArray(data.impactReports)).toBe(true);
    server.close();
  });
});
