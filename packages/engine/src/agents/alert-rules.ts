import { getOverviewMetrics, getToolMetrics, getPipelineMetrics } from "./pipeline-metrics.js";
import { getAllInsights } from "./pipeline-insights.js";
import type { ToolMetric, PipelineMetric } from "./pipeline-metrics.js";

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: "warning" | "critical";
  category: "success_rate" | "timeout_rate" | "retry_rate" | "duration" | "score";
  target: "tool" | "pipeline" | "overview";
  operator: "<" | ">" | "<=" | ">=";
  threshold: number;
}

export interface Alert {
  ruleId: string;
  severity: "warning" | "critical";
  category: string;
  message: string;
  metric: number;
  threshold: number;
  target: string;
  createdAt: string;
}

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "score-too-low",
    name: "Reliability score too low",
    enabled: true,
    severity: "critical",
    category: "score",
    target: "overview",
    operator: "<",
    threshold: 60,
  },
  {
    id: "tool-success-rate",
    name: "Tool success rate below threshold",
    enabled: true,
    severity: "critical",
    category: "success_rate",
    target: "tool",
    operator: "<",
    threshold: 0.8,
  },
  {
    id: "tool-timeout-rate",
    name: "Tool timeout rate above threshold",
    enabled: true,
    severity: "critical",
    category: "timeout_rate",
    target: "tool",
    operator: ">",
    threshold: 0.4,
  },
  {
    id: "tool-retry-rate",
    name: "Tool average retries above threshold",
    enabled: true,
    severity: "critical",
    category: "retry_rate",
    target: "tool",
    operator: ">",
    threshold: 4,
  },
  {
    id: "tool-duration",
    name: "Tool average duration above threshold",
    enabled: true,
    severity: "critical",
    category: "duration",
    target: "tool",
    operator: ">",
    threshold: 10000,
  },
];

function applyOperator(value: number, threshold: number, operator: string): boolean {
  switch (operator) {
    case "<": return value < threshold;
    case ">": return value > threshold;
    case "<=": return value <= threshold;
    case ">=": return value >= threshold;
    default: return false;
  }
}

function formatMetric(category: string, value: number): string {
  switch (category) {
    case "success_rate": return `${(value * 100).toFixed(0)}%`;
    case "timeout_rate": return `${(value * 100).toFixed(0)}%`;
    case "retry_rate": return `${value.toFixed(1)} retries`;
    case "duration": return `${Math.round(value)}ms`;
    case "score": return `${Math.round(value)}/100`;
    default: return String(value);
  }
}

export function evaluateToolRule(rule: AlertRule, metrics: ToolMetric[]): Alert[] {
  const alerts: Alert[] = [];
  for (const tool of metrics) {
    let value: number | null = null;
    switch (rule.category) {
      case "success_rate": {
        const total = tool.successCount + tool.failureCount;
        if (total === 0) continue;
        value = tool.successCount / total;
        break;
      }
      case "timeout_rate": {
        if (tool.failureCount === 0) continue;
        value = tool.timeoutCount / tool.failureCount;
        break;
      }
      case "retry_rate": {
        if (tool.avgRetries <= 0) continue;
        value = tool.avgRetries;
        break;
      }
      case "duration": {
        if (tool.avgDurationMs <= 0) continue;
        value = tool.avgDurationMs;
        break;
      }
      default: continue;
    }
    if (value !== null && applyOperator(value, rule.threshold, rule.operator)) {
      alerts.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: `Tool "${tool.toolName}" ${rule.category} is ${formatMetric(rule.category, value)} (threshold: ${formatMetric(rule.category, rule.threshold)})`,
        metric: Math.round(value * 10000) / 10000,
        threshold: rule.threshold,
        target: tool.toolName,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return alerts;
}

export function evaluatePipelineRule(rule: AlertRule, metrics: PipelineMetric[]): Alert[] {
  const alerts: Alert[] = [];
  if (rule.category !== "success_rate") return alerts;
  for (const pl of metrics) {
    if (pl.totalRuns === 0) continue;
    const value = pl.completedRuns / pl.totalRuns;
    if (applyOperator(value, rule.threshold, rule.operator)) {
      alerts.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: `Pipeline "${pl.pipelineName}" success rate is ${formatMetric(rule.category, value)} (threshold: ${formatMetric(rule.category, rule.threshold)})`,
        metric: Math.round(value * 10000) / 10000,
        threshold: rule.threshold,
        target: pl.pipelineId,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return alerts;
}

export function evaluateOverviewRule(rule: AlertRule): Alert[] {
  if (rule.category !== "score") return [];
  const overview = getOverviewMetrics();
  const insights = getAllInsights();
  const value = insights.score;
  if (applyOperator(value, rule.threshold, rule.operator)) {
    return [{
      ruleId: rule.id,
      severity: rule.severity,
      category: rule.category,
      message: `Reliability score is ${formatMetric(rule.category, value)} (threshold: ${formatMetric(rule.category, rule.threshold)})`,
      metric: value,
      threshold: rule.threshold,
      target: "overview",
      createdAt: new Date().toISOString(),
    }];
  }
  return [];
}

export function evaluateAlertRules(rules: AlertRule[] = DEFAULT_ALERT_RULES): Alert[] {
  const allAlerts: Alert[] = [];
  const toolMetrics = getToolMetrics();
  const pipelineMetrics = getPipelineMetrics();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    switch (rule.target) {
      case "tool":
        allAlerts.push(...evaluateToolRule(rule, toolMetrics));
        break;
      case "pipeline":
        allAlerts.push(...evaluatePipelineRule(rule, pipelineMetrics));
        break;
      case "overview":
        allAlerts.push(...evaluateOverviewRule(rule));
        break;
    }
  }

  return allAlerts;
}
