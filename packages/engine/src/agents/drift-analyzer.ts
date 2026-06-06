import { getPipelineRun, getPipelineStepRuns } from "./pipeline-store.js";
import type { PipelineStepRunRecord } from "./pipeline-store.js";

export type DriftKind =
  | "none"
  | "input_changed"
  | "output_changed"
  | "status_changed"
  | "step_missing"
  | "step_added";

export interface DriftEntry {
  stepId: string;
  stepType: string;
  agentId: string | null;
  toolName: string | null;
  kind: DriftKind;
  runA: { status: string; inputHash: string | null; outputHash: string | null };
  runB: { status: string; inputHash: string | null; outputHash: string | null };
  detail?: string;
}

export interface DriftSummary {
  none: number;
  inputChanged: number;
  outputChanged: number;
  statusChanged: number;
  stepMissing: number;
  stepAdded: number;
}

export interface DriftReport {
  runAId: string;
  runBId: string;
  pipelineId: string;
  totalStepsA: number;
  totalStepsB: number;
  driftCount: number;
  summary: DriftSummary;
  entries: DriftEntry[];
}

export class ExecutionComparator {
  compare(runAId: string, runBId: string): DriftReport {
    const runA = getPipelineRun(runAId);
    if (!runA) throw new Error(`Run A not found: ${runAId}`);

    const runB = getPipelineRun(runBId);
    if (!runB) throw new Error(`Run B not found: ${runBId}`);

    if (runA.pipelineId !== runB.pipelineId) {
      throw new Error(`Cannot compare runs from different pipelines: ${runA.pipelineId} vs ${runB.pipelineId}`);
    }

    const stepsA = getPipelineStepRuns(runAId);
    const stepsB = getPipelineStepRuns(runBId);

    const mapA = new Map<string, PipelineStepRunRecord>();
    const mapB = new Map<string, PipelineStepRunRecord>();
    for (const s of stepsA) mapA.set(s.stepId, s);
    for (const s of stepsB) mapB.set(s.stepId, s);

    const allStepIds = new Set([...mapA.keys(), ...mapB.keys()]);
    const entries: DriftEntry[] = [];
    const summary: DriftSummary = { none: 0, inputChanged: 0, outputChanged: 0, statusChanged: 0, stepMissing: 0, stepAdded: 0 };

    for (const stepId of allStepIds) {
      const a = mapA.get(stepId);
      const b = mapB.get(stepId);

      if (!a && b) {
        summary.stepAdded++;
        entries.push({
          stepId,
          stepType: b.stepType,
          agentId: b.agentId,
          toolName: b.toolName,
          kind: "step_added",
          runA: { status: "", inputHash: null, outputHash: null },
          runB: { status: b.status, inputHash: b.toolInputHash, outputHash: b.toolOutputHash },
        });
        continue;
      }

      if (a && !b) {
        summary.stepMissing++;
        entries.push({
          stepId,
          stepType: a.stepType,
          agentId: a.agentId,
          toolName: a.toolName,
          kind: "step_missing",
          runA: { status: a.status, inputHash: a.toolInputHash, outputHash: a.toolOutputHash },
          runB: { status: "", inputHash: null, outputHash: null },
        });
        continue;
      }

      const baseStepType = a!.stepType;
      const baseAgentId = a!.agentId;
      const baseToolName = a!.toolName;

      if (a!.status !== b!.status) {
        summary.statusChanged++;
        entries.push(entryFor(stepId, baseStepType, baseAgentId, baseToolName, "status_changed", a!, b!));
        continue;
      }

      if (a!.toolInputHash !== b!.toolInputHash) {
        summary.inputChanged++;
        entries.push(entryFor(stepId, baseStepType, baseAgentId, baseToolName, "input_changed", a!, b!));
        continue;
      }

      if (a!.toolOutputHash !== b!.toolOutputHash) {
        summary.outputChanged++;
        entries.push(entryFor(stepId, baseStepType, baseAgentId, baseToolName, "output_changed", a!, b!));
        continue;
      }

      summary.none++;
      entries.push(entryFor(stepId, baseStepType, baseAgentId, baseToolName, "none", a!, b!));
    }

    const driftCount = summary.inputChanged + summary.outputChanged + summary.statusChanged + summary.stepMissing + summary.stepAdded;

    return {
      runAId,
      runBId,
      pipelineId: runA.pipelineId,
      totalStepsA: stepsA.length,
      totalStepsB: stepsB.length,
      driftCount,
      summary,
      entries,
    };
  }
}

function entryFor(
  stepId: string,
  stepType: string,
  agentId: string | null,
  toolName: string | null,
  kind: DriftKind,
  a: PipelineStepRunRecord,
  b: PipelineStepRunRecord,
): DriftEntry {
  return {
    stepId,
    stepType,
    agentId,
    toolName,
    kind,
    runA: { status: a.status, inputHash: a.toolInputHash, outputHash: a.toolOutputHash },
    runB: { status: b.status, inputHash: b.toolInputHash, outputHash: b.toolOutputHash },
  };
}
