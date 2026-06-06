import { describe, it, expect, vi, beforeEach } from "vitest";

let mockFetch: any;

vi.mock("../../src/config/index.js", () => ({
  getConfig: () => ({}),
}));

import { performWebFetch } from "../../src/tools/webfetch.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

function mockOkResponse(html: string, contentType = "text/html") {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map(Object.entries({ "content-type": contentType })),
    text: () => Promise.resolve(html),
  });
}

function mockErrorResponse(status: number, statusText: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    statusText,
    headers: new Map(),
    text: () => Promise.resolve(""),
  });
}

describe("performWebFetch", () => {
  describe("URL validation", () => {
    it("accepts https URLs", async () => {
      mockOkResponse("<html><title>Test</title><body>Hello</body></html>");
      const result = await performWebFetch("https://example.com");
      expect(result.title).toBe("Test");
    });

    it("accepts http URLs", async () => {
      mockOkResponse("<html><title>HTTP</title><body>Ok</body></html>");
      const result = await performWebFetch("http://example.com");
      expect(result.title).toBe("HTTP");
    });

    it("rejects file: URLs", async () => {
      await expect(performWebFetch("file:///etc/passwd")).rejects.toThrow("Blocked URL scheme");
    });

    it("rejects ftp: URLs", async () => {
      await expect(performWebFetch("ftp://ftp.example.com")).rejects.toThrow("Blocked URL scheme");
    });

    it("rejects data: URLs", async () => {
      await expect(performWebFetch("data:text/html,<script>alert(1)</script>")).rejects.toThrow("Blocked URL scheme");
    });

    it("rejects javascript: URLs", async () => {
      await expect(performWebFetch("javascript:alert(1)")).rejects.toThrow("Blocked URL scheme");
    });
  });

  describe("private host rejection", () => {
    it("rejects localhost", async () => {
      await expect(performWebFetch("http://localhost:8080/secret")).rejects.toThrow("Blocked private host");
    });

    it("rejects 127.0.0.1", async () => {
      await expect(performWebFetch("http://127.0.0.1:3000/")).rejects.toThrow("Blocked private host");
    });

    it("rejects 10.x.x.x", async () => {
      await expect(performWebFetch("http://10.0.0.1/admin")).rejects.toThrow("Blocked private host");
    });

    it("rejects 192.168.x.x", async () => {
      await expect(performWebFetch("http://192.168.1.1/config")).rejects.toThrow("Blocked private host");
    });

    it("rejects 172.16-31.x.x", async () => {
      await expect(performWebFetch("http://172.20.0.1/")).rejects.toThrow("Blocked private host");
    });

    it("allows public IPs", async () => {
      mockOkResponse("<html><title>Public</title></html>");
      const result = await performWebFetch("http://93.184.216.34/");
      expect(result.title).toBe("Public");
    });
  });

  describe("HTML processing", () => {
    it("converts HTML to markdown", async () => {
      mockOkResponse("<html><title>My Page</title><body><h1>Hello</h1><p>World</p></body></html>");
      const result = await performWebFetch("https://example.com/page");
      expect(result.content).toContain("# Hello");
      expect(result.content).toContain("World");
    });

    it("extracts title", async () => {
      mockOkResponse("<html><title>The Title</title><body>Content</body></html>");
      const result = await performWebFetch("https://example.com");
      expect(result.title).toBe("The Title");
    });

    it("defaults to Untitled when no title tag", async () => {
      mockOkResponse("<html><body>No title</body></html>");
      const result = await performWebFetch("https://example.com");
      expect(result.title).toBe("Untitled");
    });

    it("extracts images", async () => {
      mockOkResponse('<html><title>Img</title><body><img src="https://example.com/photo.jpg"></body></html>');
      const result = await performWebFetch("https://example.com");
      expect(result.images).toHaveLength(1);
      expect(result.images![0]).toBe("https://example.com/photo.jpg");
    });

    it("passes non-HTML content through", async () => {
      mockOkResponse("plain text content", "text/plain");
      const result = await performWebFetch("https://example.com/file.txt");
      expect(result.content).toBe("plain text content");
    });

    it("throws on HTTP error", async () => {
      mockErrorResponse(404, "Not Found");
      await expect(performWebFetch("https://example.com/missing")).rejects.toThrow("HTTP 404");
    });
  });

  it("passes correlationId through events", async () => {
    mockOkResponse("<html><title>Test</title></html>");
    const result = await performWebFetch("https://example.com");
    expect(result.url).toBe("https://example.com/");
  });
});
