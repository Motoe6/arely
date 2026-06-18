import { describe, it, expect, vi } from "vitest";
import { DynamicRoleSelector } from "../../packages/engine/src/swarm/role-selector.js";

describe("DynamicRoleSelector", () => {
  describe("constructor", () => {
    it("creates with default options", () => {
      const selector = new DynamicRoleSelector();
      expect(selector).toBeInstanceOf(DynamicRoleSelector);
    });

    it("accepts custom options", () => {
      const classify = vi.fn(() => ({ type: "coding", complexity: 50, estimatedTokens: 1000, needsTools: false }));
      const selector = new DynamicRoleSelector({ taskClassifier: classify });
      expect(selector).toBeInstanceOf(DynamicRoleSelector);
    });
  });

  describe("selectRole", () => {
    it("returns a ranked result for a coding task", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Implement a fibonacci function in TypeScript");
      expect(result.scores.length).toBe(5);
      expect(result.recommended).toBe("hierarchical");
      expect(result.runnerUp).toBeDefined();
      expect(result.reasoning).toContain("coding");
      expect(result.taskContext.type).toBe("coding");
      expect(result.timestamp).toBeDefined();
    });

    it("recommends hierarchical for complex tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Design and implement a distributed microservice architecture with fault tolerance and auto-scaling");
      expect(result.recommended).toBe("hierarchical");
    });

    it("recommends swarm for research tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Research the latest advances in LLM agent architectures and compare their approaches");
      expect(result.recommended).toBe("swarm");
    });

    it("recommends single for simple chat (low complexity, no tools needed)", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Chat with the user about their project requirements and answer questions");
      expect(result.recommended).toBe("single");
    });

    it("recommends single for simple tool tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Search for the current weather in Tokyo");
      expect(result.recommended).toBe("single");
    });

    it("recommends single for tool-use tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Find the latest npm package version for express");
      expect(result.recommended).toBe("single");
    });

    it("recommends swarm for creative tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Brainstorm new feature ideas for a social media analytics platform");
      expect(result.recommended).toBe("swarm");
    });
  });

  describe("task classification", () => {
    it("classifies coding tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Write a Python function to sort a list");
      expect(result.taskContext.type).toBe("coding");
    });

    it("classifies research tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Investigate the root cause of the production outage");
      expect(result.taskContext.type).toBe("research");
    });

    it("classifies analysis tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Analyze the performance benchmark results and identify bottlenecks");
      expect(result.taskContext.type).toBe("analysis");
    });

    it("classifies planning tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Create a strategic roadmap for Q3 product development");
      expect(result.taskContext.type).toBe("planning");
    });

    it("classifies writing tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Write a technical report on the new authentication system");
      expect(result.taskContext.type).toBe("writing");
    });
  });

  describe("complexity estimation", () => {
    it("estimates low complexity for short tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Sort a list");
      expect(result.taskContext.complexity).toBeLessThan(30);
    });

    it("estimates high complexity for tasks with complex vocabulary", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Design a comprehensive distributed enterprise architecture with advanced multi-region deployment infrastructure");
      expect(result.taskContext.complexity).toBeGreaterThanOrEqual(60);
    });

    it("detects tool needs", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Execute a bash command to find large files");
      expect(result.taskContext.needsTools).toBe(true);
    });
  });

  describe("mode scoring", () => {
    it("hierarchical scores higher than single for complex coding tasks", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Build a full-stack application with authentication, database, and API endpoints");
      const hierarchical = result.scores.find(s => s.mode === "hierarchical")!;
      const single = result.scores.find(s => s.mode === "single")!;
      expect(hierarchical.total).toBeGreaterThan(single.total);
    });

    it("swarm scores well for research", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Research and compare different machine learning frameworks");
      const swarm = result.scores.find(s => s.mode === "swarm")!;
      expect(swarm.total).toBeGreaterThan(0.4);
    });

    it("returns breakdown for each mode", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Write a summary of the meeting notes");
      for (const score of result.scores) {
        expect(score.breakdown.benchmarkScore).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.utility).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.costEfficiency).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.latencyScore).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.contextMatch).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.memoryAffinity).toBeGreaterThanOrEqual(0);
        expect(score.breakdown.clusterLoad).toBeGreaterThanOrEqual(0);
        expect(score.total).toBeGreaterThan(0);
        expect(score.total).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("memory affinity", () => {
    it("uses searchMemory if provided", async () => {
      const searchMemory = vi.fn().mockResolvedValue([
        { content: "hierarchical execution completed successfully with utility 0.8", score: 0.9 },
      ]);
      const selector = new DynamicRoleSelector({ searchMemory });
      await selector.selectRole("Implement a feature");
      expect(searchMemory).toHaveBeenCalledTimes(5);
    });

    it("returns 0.5 when searchMemory is not provided", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Write code");
      const hierarchical = result.scores.find(s => s.mode === "hierarchical")!;
      expect(hierarchical.breakdown.memoryAffinity).toBe(0.5);
    });

    it("returns neutral score when search returns empty", async () => {
      const searchMemory = vi.fn().mockResolvedValue([]);
      const selector = new DynamicRoleSelector({ searchMemory });
      const result = await selector.selectRole("Test task");
      for (const score of result.scores) {
        expect(score.breakdown.memoryAffinity).toBe(0.5);
      }
    });
  });

  describe("cluster load", () => {
    it("penalizes distributed mode under high load", async () => {
      const getWorkerLoad = vi.fn().mockResolvedValue({
        totalWorkers: 10,
        onlineWorkers: 10,
        activeRoles: 9,
        avgLatencyMs: 100,
        failureRate: 0.05,
      });
      const selector = new DynamicRoleSelector({ getWorkerLoad });
      const result = await selector.selectRole("Write a simple function");
      const distributed = result.scores.find(s => s.mode === "distributed")!;
      expect(distributed.breakdown.clusterLoad).toBeLessThan(0.3);
    });

    it("allows all modes under low load", async () => {
      const getWorkerLoad = vi.fn().mockResolvedValue({
        totalWorkers: 10,
        onlineWorkers: 10,
        activeRoles: 2,
        avgLatencyMs: 20,
        failureRate: 0.01,
      });
      const selector = new DynamicRoleSelector({ getWorkerLoad });
      const result = await selector.selectRole("Write a simple function");
      for (const score of result.scores) {
        expect(score.breakdown.clusterLoad).toBeGreaterThanOrEqual(0.8);
      }
    });

    it("returns 0.5 when getWorkerLoad is not provided", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("Test task");
      for (const score of result.scores) {
        expect(score.breakdown.clusterLoad).toBe(0.5);
      }
    });
  });

  describe("historical data", () => {
    it("uses provided historical data for scoring", async () => {
      const getHistoricalData = vi.fn().mockImplementation((mode: string) => {
        if (mode === "hierarchical") return { successRate: 1, avgLatencyMs: 5, avgCostUsd: 0.01, utility: 0.9, scenarioCount: 100 };
        return null;
      });
      const selector = new DynamicRoleSelector({ getHistoricalData });
      const result = await selector.selectRole("Implement a feature");
      const hierarchical = result.scores.find(s => s.mode === "hierarchical")!;
      expect(hierarchical.breakdown.benchmarkScore).toBeGreaterThan(0.8);
    });
  });

  describe("policy override", () => {
    it("forces a specific mode when policy says so", async () => {
      const getPolicyValue = vi.fn().mockImplementation((name: string) => {
        if (name === "defaultExecutionMode") return "swarm";
        return undefined;
      });
      const selector = new DynamicRoleSelector({ getPolicyValue });
      const result = await selector.selectRole("Any task");
      expect(result.recommended).toBe("swarm");
      expect(result.reasoning).toContain("forced by policy");
    });
  });

  describe("updateWeights", () => {
    it("updates individual weights", async () => {
      const selector = new DynamicRoleSelector();
      selector.updateWeights({ contextMatch: 0.30 });
      const result = await selector.selectRole("Write a simple function");
      const single = result.scores.find(s => s.mode === "single")!;
      expect(single.total).toBeGreaterThan(0);
    });

    it("does not affect unset weights", async () => {
      const selector = new DynamicRoleSelector();
      const before = await selector.selectRole("Test");
      selector.updateWeights({ contextMatch: 0.30 });
      const after = await selector.selectRole("Test");
      expect(after.scores[0].mode).toBe(before.scores[0].mode);
    });
  });

  describe("edge cases", () => {
    it("handles empty goal string", async () => {
      const selector = new DynamicRoleSelector();
      const result = await selector.selectRole("");
      expect(result.scores.length).toBe(5);
      expect(result.taskContext.type).toBeDefined();
    });

    it("handles very long goal strings without crashing", async () => {
      const selector = new DynamicRoleSelector();
      const longGoal = "Analyze ".repeat(100) + "the results";
      const result = await selector.selectRole(longGoal);
      expect(result.scores.length).toBe(5);
    });

    it("handles searchMemory throwing an error gracefully", async () => {
      const searchMemory = vi.fn().mockRejectedValue(new Error("DB connection failed"));
      const selector = new DynamicRoleSelector({ searchMemory });
      const result = await selector.selectRole("Test task");
      for (const score of result.scores) {
        expect(score.breakdown.memoryAffinity).toBe(0.5);
      }
    });
  });
});
