import { describe, it, expect } from "vitest";
import { computeDelay } from "../../src/agents/retry-policy.js";
import type { RetryStrategy } from "../../src/agents/execution-contract.js";

describe("computeDelay", () => {
  describe("fixed", () => {
    it("returns baseMs for attempt 1", () => {
      expect(computeDelay(1, 1000, "fixed")).toBe(1000);
    });

    it("returns baseMs for attempt 5", () => {
      expect(computeDelay(5, 1000, "fixed")).toBe(1000);
    });

    it("returns 0 when baseMs is 0", () => {
      expect(computeDelay(3, 0, "fixed")).toBe(0);
    });

    it("caps at maxDelayMs", () => {
      expect(computeDelay(1, 70000, "fixed", 60000)).toBe(60000);
    });
  });

  describe("linear", () => {
    it("returns baseMs * attempt", () => {
      expect(computeDelay(1, 1000, "linear")).toBe(1000);
      expect(computeDelay(2, 1000, "linear")).toBe(2000);
      expect(computeDelay(3, 1000, "linear")).toBe(3000);
    });

    it("caps at maxDelayMs", () => {
      expect(computeDelay(100, 1000, "linear", 60000)).toBe(60000);
    });

    it("returns 0 when baseMs is 0", () => {
      expect(computeDelay(5, 0, "linear")).toBe(0);
    });
  });

  describe("exponential", () => {
    it("returns baseMs * 2^(attempt-1)", () => {
      expect(computeDelay(1, 1000, "exponential")).toBe(1000);
      expect(computeDelay(2, 1000, "exponential")).toBe(2000);
      expect(computeDelay(3, 1000, "exponential")).toBe(4000);
      expect(computeDelay(4, 1000, "exponential")).toBe(8000);
    });

    it("caps at maxDelayMs", () => {
      expect(computeDelay(20, 1000, "exponential", 60000)).toBe(60000);
    });

    it("returns 0 when baseMs is 0", () => {
      expect(computeDelay(10, 0, "exponential")).toBe(0);
    });
  });

  describe("exponential_jitter", () => {
    it("returns value between 0 and exp for attempt 1", () => {
      for (let i = 0; i < 20; i++) {
        const d = computeDelay(1, 1000, "exponential_jitter");
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1000);
      }
    });

    it("returns value between 0 and 2*base for attempt 2", () => {
      for (let i = 0; i < 20; i++) {
        const d = computeDelay(2, 1000, "exponential_jitter");
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(2000);
      }
    });

    it("returns value between 0 and 4*base for attempt 3", () => {
      for (let i = 0; i < 20; i++) {
        const d = computeDelay(3, 1000, "exponential_jitter");
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(4000);
      }
    });

    it("produces variance across calls", () => {
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(computeDelay(3, 1000, "exponential_jitter"));
      }
      expect(results.size).toBeGreaterThan(1);
    });

    it("caps at maxDelayMs", () => {
      for (let i = 0; i < 20; i++) {
        const d = computeDelay(20, 1000, "exponential_jitter", 60000);
        expect(d).toBeLessThanOrEqual(60000);
      }
    });

    it("returns 0 when baseMs is 0", () => {
      expect(computeDelay(3, 0, "exponential_jitter")).toBe(0);
    });
  });

  describe("default maxDelayMs", () => {
    it("defaults to 60000", () => {
      expect(computeDelay(20, 1000, "exponential")).toBe(60000);
    });
  });
});
