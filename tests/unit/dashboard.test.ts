import { describe, it, expect } from "vitest";
import { renderDashboardPage } from "../../src/ui/dashboard.js";

describe("renderDashboardPage", () => {
  it("returns a valid HTML string", () => {
    const html = renderDashboardPage();
    expect(html).toBeTypeOf("string");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("contains the Overview section", () => {
    const html = renderDashboardPage();
    expect(html).toContain("Overview");
    expect(html).toContain("Uptime");
    expect(html).toContain("Traces");
    expect(html).toContain("Packs");
    expect(html).toContain("Health");
  });

  it("contains the Packs section", () => {
    const html = renderDashboardPage();
    expect(html).toContain("PolicyHash");
    expect(html).toContain("Modified");
  });

  it("contains the Recommendations and Pipeline sections", () => {
    const html = renderDashboardPage();
    expect(html).toContain("Recommendations");
    expect(html).toContain("Pipeline Explorer");
    expect(html).toContain("Loading packs");
    expect(html).toContain("Run Pipeline");
  });

  it("accepts custom title and version options", () => {
    const html = renderDashboardPage({ title: "Custom Title", version: "2.0.0" });
    expect(html).toContain("Custom Title");
    expect(html).toContain("v2.0.0");
  });
});
