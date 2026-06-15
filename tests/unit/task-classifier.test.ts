import { describe, it, expect } from "vitest";
import { TaskClassifier } from "@arelyos/engine/llm/task-classifier.js";

describe("TaskClassifier", () => {
  const classifier = new TaskClassifier();

  it("should classify coding tasks", () => {
    const result = classifier.classify("implement a new REST API endpoint in TypeScript");
    expect(result.type).toBe("coding");
    expect(result.needsTools).toBe(true);
  });

  it("should classify debugging tasks", () => {
    const result = classifier.classify("fix the null pointer exception in the request handler");
    expect(result.type).toBe("debugging");
  });

  it("should classify planning tasks", () => {
    const result = classifier.classify("design the architecture for the new microservice");
    expect(result.type).toBe("planning");
  });

  it("should classify research tasks", () => {
    const result = classifier.classify("investigate the system requirements and document the findings");
    expect(result.type).toBe("research");
  });

  it("should classify conversation tasks", () => {
    const result = classifier.classify("hello, how are you?");
    expect(result.type).toBe("conversation");
    expect(result.needsTools).toBe(false);
  });

  it("should classify tool_use tasks", () => {
    const result = classifier.classify("run npm install and restart the server");
    expect(result.type).toBe("tool_use");
    expect(result.needsTools).toBe(true);
  });

  it("should classify agentic tasks", () => {
    const result = classifier.classify("set up an automated multi-step deployment pipeline");
    expect(result.type).toBe("agentic");
    expect(result.needsTools).toBe(true);
  });

  it("should classify cheap tasks", () => {
    const result = classifier.classify("give a concise yes or no answer");
    expect(result.type).toBe("cheap");
  });

  it("should compute complexity based on pattern density", () => {
    const simple = classifier.classify("hi");
    const complex = classifier.classify("implement a function that writes code to debug the broken tool pipeline");
    expect(complex.complexity).toBeGreaterThanOrEqual(simple.complexity);
  });

  it("should estimate tokens proportional to complexity and type", () => {
    const simple = classifier.classify("ok");
    const complex = classifier.classify("implement a multi-step agentic workflow that automates debugging");
    expect(complex.estimatedTokens).toBeGreaterThan(simple.estimatedTokens);
  });
});
