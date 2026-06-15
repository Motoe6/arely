import type { IncomingMessage, ServerResponse } from "node:http";
import { ulid } from "ulid";
import type { Router } from "../transport/router.js";
import { queryGoals, queryGoalPlans, queryMilestones, getGoal, updateGoal, createGoal, createGoalPlan, createMilestone } from "@arelyos/persistence";
import { goalUtilityScorer } from "../llm/goal-utility-scorer.js";

export function registerGoalRoutes(router: Router): void {
  const asyncHandler = (
    fn: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>,
  ) => {
    return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
      fn(req, res, params).catch((err) => {
        try {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        } catch { /* ignore */ }
      });
    };
  };

  router.get("/api/goals", (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(_req.url ?? "/", "http://localhost");
      const status = url.searchParams.get("status") ?? undefined;
      const goals = queryGoals({ status: status as any });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, goals }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.get("/api/goals/:id", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const goal = getGoal(params.id);
      if (!goal) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Goal not found" }));
        return;
      }
      const plans = queryGoalPlans({ goalId: goal.id });
      const plansWithMilestones = plans.map((plan) => {
        const milestones = queryMilestones({ planId: plan.id });
        return { ...plan, milestones };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, goal, plans: plansWithMilestones }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.post("/api/goals", asyncHandler(async (req, res) => {
    const data = (req as any).body;
    if (!data || !data.title) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "title is required" }));
      return;
    }
    const goal = createGoal({
      id: ulid(),
      title: data.title,
      description: data.description ?? "",
      status: data.status ?? "active",
      priority: data.priority ?? 0,
      progressPct: data.progressPct ?? 0,
      metadata: data.metadata ?? {},
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, goal }));
  }));

  router.put("/api/goals/:id", asyncHandler(async (req, res, params) => {
    const data = (req as any).body;
    if (!data) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Request body required" }));
      return;
    }
    const goal = getGoal(params.id);
    if (!goal) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Goal not found" }));
      return;
    }
    const updated = updateGoal(params.id, {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      progressPct: data.progressPct,
      completedAt: data.completedAt,
      metadata: data.metadata,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, updated }));
  }));

  router.get("/api/goals/:id/forecast", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const goal = getGoal(params.id);
      if (!goal) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Goal not found" }));
        return;
      }
      const forecast = goalUtilityScorer.scoreGoal(params.id, {
        successProbability: 0.7,
        expectedCostUsd: 0,
        expectedLatencyMs: 0,
        confidence: 0.5,
        risk: "medium",
        rationale: [],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, forecast }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.post("/api/goals/:id/plans", asyncHandler(async (req, res, params) => {
    const data = (req as any).body;
    if (!data || !data.title) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "title is required" }));
      return;
    }
    const goal = getGoal(params.id);
    if (!goal) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Goal not found" }));
      return;
    }
    const plan = createGoalPlan({
      id: ulid(),
      goalId: params.id,
      title: data.title,
      description: data.description ?? "",
      status: data.status ?? "pending",
      sortOrder: data.sortOrder ?? 0,
      dependencies: data.dependencies ?? [],
      progressPct: 0,
      metadata: data.metadata ?? {},
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, plan }));
  }));

  router.post("/api/goals/:id/plans/:planId/milestones", asyncHandler(async (req, res, params) => {
    const data = (req as any).body;
    if (!data || !data.description) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "description is required" }));
      return;
    }
    const milestone = createMilestone({
      id: ulid(),
      planId: params.planId,
      description: data.description,
      status: data.status ?? "pending",
      weight: data.weight ?? 1,
      metadata: data.metadata ?? {},
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, milestone }));
  }));
}