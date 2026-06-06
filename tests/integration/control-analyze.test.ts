import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHttpServer } from "@opencode/engine/transport/http-server.js";
import { SSEBus } from "@opencode/engine/server/sse.js";
import { loadConfig } from "@opencode/engine/config/index.js";
import { insertEvent } from "@opencode/engine/persistence/policy-audit-store.js";
import type { PolicyRule } from "@opencode/engine/agents/policy/policy-types.js";

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

const tmpDir = join(tmpdir(), "control-analyze-test");
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

describe("M10.1 POST /control/analyze", () => {
  beforeAll(() => {
    initTestDb();
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    process.env.OPENCODE_API_KEY = "test-key";
    process.env.OPENCODE_POLICY_PACKS_DIR = tmpDir;
    loadConfig();

    // Seed audit traces so recommendation logic has data to analyze
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

  it("returns full response shape with recommendations and summary for a valid pack", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const rules: PolicyRule[] = [
      makeRule("high_success", { successRate: { lt: 0.9 } }),
    ];
    const createRes = await postUrl(`http://localhost:${port}/packs`, { name: "shape-analyze", description: "", rules });
    const pack = JSON.parse(createRes.body);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/analyze`, { packId: pack.id });
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.packId).toBe(pack.id);
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(Array.isArray(data.validatedRecommendations)).toBe(true);
    expect(data.validatedRecommendations).toHaveLength(data.recommendations.length);
    expect(data.summary).toHaveProperty("critical");
    expect(data.summary).toHaveProperty("high");
    expect(data.summary).toHaveProperty("medium");
    expect(data.summary).toHaveProperty("low");
    expect(data.summary).toHaveProperty("total");
    expect(data.summary.total).toBe(data.recommendations.length);
    expect(data.summary).toHaveProperty("averageImpactScore");
    expect(data.summary).toHaveProperty("maxImpactScore");
    server.close();
  });

  it("detects dead_rule recommendation when a rule never matches", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const rules: PolicyRule[] = [
      makeRule("high_success", { successRate: { lt: 0.9 } }),
      makeRule("dead_rule", { successRate: { lt: 0 } }),
    ];
    const createRes = await postUrl(`http://localhost:${port}/packs`, { name: "dead-analyze", description: "", rules });
    const pack = JSON.parse(createRes.body);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/analyze`, { packId: pack.id });
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(data.recommendations.some((r: { type: string }) => r.type === "dead_rule")).toBe(true);
    expect(data.validatedRecommendations).toHaveLength(data.recommendations.length);
    expect(data.summary.total).toBe(data.recommendations.length);
    expect(data.summary.critical + data.summary.high + data.summary.medium + data.summary.low).toBe(data.summary.total);
    server.close();
  });

  it("returns 400 when packId is missing", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/analyze`, {});
    expect(statusCode).toBe(400);
    const data = JSON.parse(body);
    expect(data.error).toBe("packId is required");
    server.close();
  });

  it("returns 400 for invalid JSON body", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const json = "not-json";
    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(`http://localhost:${port}/control/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json).toString() },
      }, (res) => {
        let b = "";
        res.on("data", (chunk: string) => { b += chunk; });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: b }));
      });
      req.on("error", (err: Error) => reject(err));
      req.write(json);
      req.end();
    });
    expect(statusCode).toBe(400);
    const data = JSON.parse(body);
    expect(data.error).toBe("invalid JSON body");
    server.close();
  });

  it("returns empty result for nonexistent packId (lenient)", async () => {
    const server = createHttpServer({ sse, port: 0, middleware: [rawBodyParser()] });
    const port = await listenOnRandomPort(server);

    const { statusCode, body } = await postUrl(`http://localhost:${port}/control/analyze`, { packId: "nonexistent-pack" });
    expect(statusCode).toBe(200);
    const data = JSON.parse(body);
    expect(data.packId).toBe("nonexistent-pack");
    expect(data.recommendations).toEqual([]);
    expect(data.validatedRecommendations).toEqual([]);
    expect(data.summary.averageImpactScore).toBe(0);
    expect(data.summary.maxImpactScore).toBe(0);
    server.close();
  });
});
