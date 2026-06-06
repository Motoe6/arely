import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTestDb, cleanupTestDb } from "../setup.js";
import http from "node:http";
import { createHttpServer } from "../../src/transport/http-server.js";
import { SSEBus } from "../../src/server/sse.js";
import { loadConfig } from "../../src/config/index.js";

const sse = new SSEBus();

function fetchUrl(url: string): Promise<{ statusCode: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body, contentType: res.headers["content-type"] ?? "" }));
    }).on("error", (err: Error) => reject(err));
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

describe("GET /dashboard", () => {
  beforeAll(() => {
    process.env.OPENCODE_API_KEY = "test-key";
    loadConfig();
    initTestDb();
  });

  afterAll(() => cleanupTestDb());

  it("returns 200 OK", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { statusCode } = await fetchUrl(`http://localhost:${port}/dashboard`);
    expect(statusCode).toBe(200);
    server.close();
  });

  it("returns text/html content type", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { contentType } = await fetchUrl(`http://localhost:${port}/dashboard`);
    expect(contentType).toContain("text/html");
    server.close();
  });

  it("contains the navigation tabs in the body", async () => {
    const server = createHttpServer({ sse, port: 0 });
    const port = await listenOnRandomPort(server);
    const { body } = await fetchUrl(`http://localhost:${port}/dashboard`);
    expect(body).toContain("Overview");
    expect(body).toContain("Packs");
    expect(body).toContain("Recommendations");
    expect(body).toContain("Pipeline Explorer");
    server.close();
  });
});
