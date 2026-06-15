import type { IncomingMessage, ServerResponse } from "node:http";
import { ulid } from "ulid";
import type { Router } from "../transport/router.js";
import { taskGraphBuilder } from "../llm/task-graph-builder.js";
import type { ParallelSwarmResult, AgentContribution } from "../llm/parallel-swarm-orchestrator.js";

interface SwarmRecord {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  result?: ParallelSwarmResult;
}

const swarmRegistry = new Map<string, SwarmRecord>();

export function registerSwarmRoutes(router: Router): void {
  router.get("/api/swarms", (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const swarms = Array.from(swarmRegistry.values()).map((s) => ({
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        roleCount: s.result?.tasks.length ?? 0,
        phaseCount: s.result ? new Set(s.result.tasks.map((t) => {
          const phaseIndex = findPhaseIndex(s.result!.tasks, t.id);
          return phaseIndex;
        })).size : 0,
        request: s.result?.request ?? "",
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, swarms }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.get("/api/swarms/:id", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const record = swarmRegistry.get(params.id);
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Swarm not found" }));
        return;
      }
      const tasks = record.result?.tasks ?? [];
      const roleStates = tasks.map((t, idx) => ({
        role: t.role,
        taskId: t.id,
        goal: t.goal,
        dependencies: t.dependencies,
        status: record.status === "running" ? (idx < 2 ? "completed" : idx === 2 ? "running" : "queued") : record.status === "completed" ? "completed" : "failed",
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        swarm: { id: record.id, status: record.status, startedAt: record.startedAt, completedAt: record.completedAt },
        roles: roleStates,
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.get("/api/swarms/:id/graph", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const record = swarmRegistry.get(params.id);
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Swarm not found" }));
        return;
      }
      const graph = taskGraphBuilder.build(record.result?.plan ?? "", record.result?.request ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, graph }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.get("/api/swarms/:id/memory", (_req: IncomingMessage, res: ServerResponse, params) => {
    try {
      const record = swarmRegistry.get(params.id);
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Swarm not found" }));
        return;
      }
      const contributions: AgentContribution[] = record.result?.contributions ?? [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, contributions }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });

  router.get("/api/swarms/default/graph", (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(_req.url ?? "/", "http://localhost");
      const plan = url.searchParams.get("plan") ?? "Analyze the task and implement a solution";
      const request = url.searchParams.get("request") ?? "Process the user request";
      const graph = taskGraphBuilder.build(plan, request);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, graph }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  });
}

export function registerSwarmExecution(id: string, status: SwarmRecord["status"], result?: ParallelSwarmResult): void {
  const existing = swarmRegistry.get(id);
  if (existing) {
    existing.status = status;
    if (status === "completed" || status === "failed") existing.completedAt = Date.now();
    if (result) existing.result = result;
  } else {
    swarmRegistry.set(id, { id, status, startedAt: Date.now(), completedAt: status === "completed" || status === "failed" ? Date.now() : undefined, result });
  }
}

function findPhaseIndex(tasks: ParallelSwarmResult["tasks"], taskId: string): number {
  const deps = tasks.find((t) => t.id === taskId)?.dependencies ?? [];
  if (deps.length === 0) return 0;
  let maxDep = 0;
  for (const d of deps) {
    const idx = findPhaseIndex(tasks, d);
    if (idx >= maxDep) maxDep = idx + 1;
  }
  return maxDep;
}
