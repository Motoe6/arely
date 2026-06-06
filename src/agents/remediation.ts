import type { ReliabilityInsight } from "./pipeline-insights.js";
import type { Alert } from "./alert-rules.js";

export interface RemediationAction {
  id: string;
  priority: "low" | "medium" | "high";
  title: string;
  description: string;
  recommendation: string;
  targetType: "tool" | "pipeline" | "overview";
  targetId: string;
  category: string;
  sourceType: "insight" | "alert";
  sourceInsightIds: string[];
  suggestedPolicy?: string;
}

interface Candidate {
  severity: string;
  category: string;
  targetType: string;
  targetId: string;
  message: string;
  metric: number;
  threshold: number;
  sourceType: "insight" | "alert";
  insightIds: string[];
  recommendation: string;
}

function severityToPriority(severity: string): "low" | "medium" | "high" {
  switch (severity) {
    case "critical": return "high";
    case "warning": return "medium";
    default: return "low";
  }
}

function suggestPolicy(
  category: string,
  targetType: string,
  severity: string,
): string | undefined {
  if (severity !== "critical") return undefined;
  if (category === "timeout_rate") return "exponential_jitter";
  if (category === "retry_rate") return "exponential_jitter";
  if (category === "success_rate") return "circuit_breaker_candidate";
  if (category === "duration") return "timeout_increase";
  if (category === "score" && targetType === "overview") return "comprehensive_review";
  return undefined;
}

function buildTitle(category: string, targetType: string, targetId: string): string {
  const t = targetType === "overview" ? "System" : `${targetType} "${targetId}"`;
  const labels: Record<string, string> = {
    success_rate: "low success rate",
    timeout_rate: "high timeout rate",
    retry_rate: "excessive retries",
    duration: "slow execution",
    usage: "tool not recently used",
    score: "degraded reliability score",
  };
  return `${t} — ${labels[category] ?? category}`;
}

function buildDescription(category: string, severity: string, message: string): string {
  if (severity === "critical") return `Critical: ${message}`;
  if (severity === "warning") return `Warning: ${message}`;
  return `Info: ${message}`;
}

function groupKey(targetType: string, targetId: string, category: string): string {
  return `${targetType}::${targetId}::${category}`;
}

function buildId(category: string, targetType: string, targetId: string): string {
  return `remediation::${category}::${targetType}::${targetId}`;
}

export function generateRemediations(
  insights: ReliabilityInsight[],
  alerts: Alert[],
): RemediationAction[] {
  const candidates: Candidate[] = [];

  const targetTypeLookup = new Map<string, string>();
  for (const ins of insights) {
    targetTypeLookup.set(ins.targetId, ins.targetType);
  }

  for (const ins of insights) {
    candidates.push({
      severity: ins.severity,
      category: ins.category,
      targetType: ins.targetType,
      targetId: ins.targetId,
      message: ins.message,
      metric: ins.metric,
      threshold: ins.threshold,
      sourceType: "insight",
      insightIds: [ins.id],
      recommendation: ins.recommendation,
    });
  }

  for (const alert of alerts) {
    const targetType = alert.target === "overview"
      ? "overview"
      : (targetTypeLookup.get(alert.target) ?? "tool");
    candidates.push({
      severity: alert.severity,
      category: alert.category,
      targetType,
      targetId: alert.target,
      message: alert.message,
      metric: alert.metric,
      threshold: alert.threshold,
      sourceType: "alert",
      insightIds: [],
      recommendation: alert.message,
    });
  }

  const grouped = new Map<string, Candidate[]>();
  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  for (const c of candidates) {
    const key = groupKey(c.targetType, c.targetId, c.category);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  const actions: RemediationAction[] = [];

  for (const [, group] of grouped) {
    group.sort((a, b) => (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99));
    const best = group[0];
    const allIds = group.flatMap((g) => g.insightIds).filter(Boolean);
    const hasAlert = group.some((g) => g.sourceType === "alert");

    actions.push({
      id: buildId(best.category, best.targetType, best.targetId),
      priority: severityToPriority(best.severity),
      title: buildTitle(best.category, best.targetType, best.targetId),
      description: buildDescription(best.category, best.severity, best.message),
      recommendation: best.recommendation,
      targetType: best.targetType as "tool" | "pipeline" | "overview",
      targetId: best.targetId,
      category: best.category,
      sourceType: hasAlert ? "alert" : "insight",
      sourceInsightIds: allIds,
      suggestedPolicy: suggestPolicy(best.category, best.targetType, best.severity),
    });
  }

  return actions;
}
