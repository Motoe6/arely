import { getToolMetrics, getPipelineMetrics } from "./pipeline-metrics.js";
import type { ToolMetric, PipelineMetric } from "./pipeline-metrics.js";

export interface ReliabilityInsight {
  id: string;
  severity: "info" | "warning" | "critical";
  category: "success_rate" | "timeout_rate" | "retry_rate" | "duration" | "usage";
  targetType: "tool" | "pipeline";
  targetId: string;
  message: string;
  metric: number;
  threshold: number;
  recommendation: string;
}

export interface ReliabilityInsightsResponse {
  score: number;
  insights: ReliabilityInsight[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function rule(
  category: ReliabilityInsight["category"],
  value: number,
  targetType: "tool" | "pipeline",
  targetId: string,
  rules: { severity: ReliabilityInsight["severity"]; threshold: number; msg: string; rec: string }[],
  compareOp: "lt" | "gt",
): ReliabilityInsight | null {
  for (const r of rules) {
    const triggered = compareOp === "lt" ? value < r.threshold : value > r.threshold;
    if (triggered) {
      return {
        id: `${category}::${targetType}::${targetId}::${r.severity}`,
        severity: r.severity, category, targetType, targetId, message: r.msg,
        metric: value, threshold: r.threshold, recommendation: r.rec,
      };
    }
  }
  return null;
}

function sortInsights(insights: ReliabilityInsight[]): ReliabilityInsight[] {
  return insights.sort((a, b) => {
    const sd = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (sd !== 0) return sd;
    const cd = a.category.localeCompare(b.category);
    if (cd !== 0) return cd;
    const td = a.targetId.localeCompare(b.targetId);
    if (td !== 0) return td;
    return a.targetType.localeCompare(b.targetType);
  });
}

function computeScore(insights: ReliabilityInsight[]): number {
  let score = 100;
  for (const ins of insights) {
    if (ins.severity === "critical") score -= 25;
    else if (ins.severity === "warning") score -= 10;
    else score -= 2;
  }
  return Math.max(0, score);
}

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

export function analyzeToolMetrics(metrics: ToolMetric[]): ReliabilityInsight[] {
  const insights: ReliabilityInsight[] = [];

  for (const tool of metrics) {
    const totalAttempts = tool.successCount + tool.failureCount;

    if (totalAttempts > 0) {
      const successRate = tool.successCount / totalAttempts;
      const ir = rule("success_rate", Math.round(successRate * 10000) / 10000, "tool", tool.toolName, [
        { severity: "critical", threshold: 0.8, msg: `Success rate ${(successRate * 100).toFixed(0)}%`, rec: "Review tool configuration or external API availability" },
        { severity: "warning", threshold: 0.9, msg: `Success rate ${(successRate * 100).toFixed(0)}%`, rec: "Monitor tool reliability" },
        { severity: "info", threshold: 0.95, msg: `Success rate ${(successRate * 100).toFixed(0)}%`, rec: "Consider reviewing error patterns" },
      ], "lt");
      if (ir) insights.push(ir);
    }

    if (tool.failureCount > 0) {
      const timeoutRate = tool.timeoutCount / tool.failureCount;
      const ir = rule("timeout_rate", Math.round(timeoutRate * 10000) / 10000, "tool", tool.toolName, [
        { severity: "critical", threshold: 0.4, msg: `${(timeoutRate * 100).toFixed(0)}% of failures are timeouts`, rec: "Increase timeout or check external API availability" },
        { severity: "warning", threshold: 0.2, msg: `${(timeoutRate * 100).toFixed(0)}% of failures are timeouts`, rec: "Monitor timeout trends" },
        { severity: "info", threshold: 0.1, msg: `${(timeoutRate * 100).toFixed(0)}% of failures are timeouts`, rec: "Evaluate if current timeout is appropriate" },
      ], "gt");
      if (ir) insights.push(ir);
    }

    if (tool.avgRetries > 0) {
      const ir = rule("retry_rate", Math.round(tool.avgRetries * 100) / 100, "tool", tool.toolName, [
        { severity: "critical", threshold: 4, msg: `Avg ${tool.avgRetries} retries per execution`, rec: "Implement exponential backoff with jitter" },
        { severity: "warning", threshold: 2, msg: `Avg ${tool.avgRetries} retries per execution`, rec: "Consider increasing retry delay or backoff" },
        { severity: "info", threshold: 1, msg: `Avg ${tool.avgRetries} retries per execution`, rec: "Retries are being utilized — monitor if trend increases" },
      ], "gt");
      if (ir) insights.push(ir);
    }

    if (tool.avgDurationMs > 2000) {
      const ir = rule("duration", tool.avgDurationMs, "tool", tool.toolName, [
        { severity: "critical", threshold: 10000, msg: `Avg duration ${tool.avgDurationMs}ms`, rec: "Evaluate if tool timeout is correctly configured" },
        { severity: "warning", threshold: 5000, msg: `Avg duration ${tool.avgDurationMs}ms`, rec: "Monitor tool performance" },
        { severity: "info", threshold: 2000, msg: `Avg duration ${tool.avgDurationMs}ms`, rec: "Tool is slower than expected — review if acceptable" },
      ], "gt");
      if (ir) insights.push(ir);
    }

    if (!tool.lastSeenAt) {
      insights.push({
        id: `usage::tool::${tool.toolName}::info`,
        severity: "info", category: "usage", targetType: "tool", targetId: tool.toolName,
        message: "Tool has never been used",
        metric: 0, threshold: 0,
        recommendation: "Remove tool from pipeline configurations if not needed",
      });
    } else {
      const daysSince = (Date.now() - new Date(tool.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) {
        insights.push({
          id: `usage::tool::${tool.toolName}::info`,
          severity: "info", category: "usage", targetType: "tool", targetId: tool.toolName,
          message: `Last used ${Math.floor(daysSince)} days ago`,
          metric: Math.round(daysSince), threshold: 30,
          recommendation: "Evaluate if tool is still needed",
        });
      }
    }
  }

  return sortInsights(insights);
}

export function analyzePipelineMetrics(metrics: PipelineMetric[]): ReliabilityInsight[] {
  const insights: ReliabilityInsight[] = [];

  for (const pl of metrics) {
    if (pl.totalRuns === 0) continue;
    const successRate = pl.completedRuns / pl.totalRuns;
    const ir = rule("success_rate", Math.round(successRate * 10000) / 10000, "pipeline", pl.pipelineId, [
      { severity: "critical", threshold: 0.8, msg: `Pipeline "${pl.pipelineName}" success rate ${(successRate * 100).toFixed(0)}%`, rec: "Review pipeline steps and error patterns" },
      { severity: "warning", threshold: 0.9, msg: `Pipeline "${pl.pipelineName}" success rate ${(successRate * 100).toFixed(0)}%`, rec: "Monitor pipeline reliability" },
      { severity: "info", threshold: 0.95, msg: `Pipeline "${pl.pipelineName}" success rate ${(successRate * 100).toFixed(0)}%`, rec: "Review pipeline failure patterns" },
    ], "lt");
    if (ir) insights.push(ir);
  }

  return insights;
}

export function getAllInsights(): ReliabilityInsightsResponse {
  const toolMetrics = getToolMetrics();
  const pipelineMetrics = getPipelineMetrics();

  const insights: ReliabilityInsight[] = [
    ...analyzeToolMetrics(toolMetrics),
    ...analyzePipelineMetrics(pipelineMetrics),
  ];

  return {
    score: computeScore(insights),
    insights: sortInsights(insights),
  };
}
