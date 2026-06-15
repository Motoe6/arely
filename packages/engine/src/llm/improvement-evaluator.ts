import type { SelfAssessment, Finding, AssessmentDimension } from "./self-assessment-types.js";
import type { ImprovementEvaluation, ImprovementDelta } from "./improvement-evaluator-types.js";

function key(f: Finding): string {
  return `${f.dimension}::${f.label}`;
}

function metricFrom(assessment: SelfAssessment, dimension: AssessmentDimension, label: string): number | null {
  for (const f of [...assessment.strengths, ...assessment.weaknesses]) {
    if (f.dimension === dimension && f.label === label) return f.metric;
  }
  return null;
}

export { type ImprovementEvaluation, type ImprovementDelta } from "./improvement-evaluator-types.js";

export class ImprovementEvaluator {
  evaluate(before: SelfAssessment, after: SelfAssessment): ImprovementEvaluation {
    const beforeWeaknessMap = new Map<string, Finding>();
    for (const w of before.weaknesses) beforeWeaknessMap.set(key(w), w);

    const afterWeaknessMap = new Map<string, Finding>();
    for (const w of after.weaknesses) afterWeaknessMap.set(key(w), w);

    const resolvedWeaknesses: Finding[] = [];
    const persistentWeaknesses: Finding[] = [];
    const newWeaknesses: Finding[] = [];
    const deltas: ImprovementDelta[] = [];

    for (const w of before.weaknesses) {
      const k = key(w);
      const afterMatch = afterWeaknessMap.get(k);
      if (afterMatch) {
        persistentWeaknesses.push(afterMatch);
        const delta = afterMatch.metric - w.metric;
        deltas.push({
          dimension: w.dimension,
          label: w.label,
          beforeMetric: w.metric,
          afterMetric: afterMatch.metric,
          delta: Math.round(delta * 100) / 100,
          improved: delta > 0,
        });
      } else {
        const afterMetric = metricFrom(after, w.dimension, w.label);
        if (afterMetric !== null) {
          const delta = afterMetric - w.metric;
          deltas.push({
            dimension: w.dimension,
            label: w.label,
            beforeMetric: w.metric,
            afterMetric,
            delta: Math.round(delta * 100) / 100,
            improved: delta > 0,
          });
        }
        resolvedWeaknesses.push(w);
      }
    }

    for (const w of after.weaknesses) {
      const k = key(w);
      if (!beforeWeaknessMap.has(k)) {
        newWeaknesses.push(w);
      }
    }

    const totalImproved = deltas.filter((d) => d.improved).length;
    const totalDeclined = deltas.filter((d) => d.delta < 0).length;

    const summaryParts: string[] = [];
    if (resolvedWeaknesses.length > 0) summaryParts.push(`${resolvedWeaknesses.length} resolved`);
    if (persistentWeaknesses.length > 0) summaryParts.push(`${persistentWeaknesses.length} persistent`);
    if (newWeaknesses.length > 0) summaryParts.push(`${newWeaknesses.length} new`);
    if (totalImproved > 0) summaryParts.push(`${totalImproved} improved`);
    if (totalDeclined > 0) summaryParts.push(`${totalDeclined} declined`);

    return {
      deltas,
      resolvedWeaknesses,
      newWeaknesses,
      persistentWeaknesses,
      totalImproved,
      totalDeclined,
      summary: summaryParts.length > 0 ? summaryParts.join(", ") : "No changes detected",
    };
  }
}

export const improvementEvaluator = new ImprovementEvaluator();
