import React from "react";
import { Box, Text, useInput } from "ink";
import { uiStore } from "@arely/ui-core/stores/ui-store.js";
import { getGoals } from "../services/goal-service.js";
import type { StoredGoal } from "@arely/ui-core/types/index.js";

interface GoalDetail {
  goal: StoredGoal;
  plan?: string;
  milestones: { description: string; done: boolean }[];
  expectedUtility?: number;
  priority?: string;
}

function bar(pct: number, width = 16): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function GoalsPanel() {
  const [goals, setGoals] = React.useState<StoredGoal[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<GoalDetail | null>(null);

  React.useEffect(() => { getGoals().then(setGoals); }, []);

  React.useEffect(() => {
    if (!selected) { setDetails(null); return; }
    (async () => {
      try {
        const { goalResumeService } = await import("@arely/engine/llm/goal-resume-service.js");
        const ctx = goalResumeService.buildResumeContext("", 10);
        const goal = goals.find((g) => g.id === selected);
        if (!goal) return;
        const plan = ctx.plans.find((p: { goalId: string }) => p.goalId === selected);
        const prior = ctx.prioritizedMilestones.filter((m: { goalId: string }) => m.goalId === selected);
        const mstones = prior.slice(0, 6).map((m: { description: string; milestoneId: string }) => ({
          description: m.description,
          done: ctx.milestones.some((ms: { id: string; status: string }) => ms.id === m.milestoneId && ms.status === "completed"),
        }));
        const pItem = ctx.prioritizedMilestones.find((m: { goalId: string }) => m.goalId === selected);
        setDetails({
          goal,
          plan: plan?.description ?? undefined,
          milestones: mstones,
          expectedUtility: pItem ? Number(pItem.utility.toFixed(2)) : undefined,
          priority: goal.status === "active" ? "HIGH" : "NORMAL",
        });
      } catch {
        setDetails(null);
      }
    })();
  }, [selected, goals]);

  useInput((_input, key) => {
    if (key.escape || (_input === "g" && key.ctrl)) {
      if (selected) { setSelected(null); return; }
      uiStore.setState({ goalsOpen: false });
      return;
    }
    if (key.return) {
      if (!selected && goals.length > 0) { setSelected(goals[0].id); return; }
      if (selected) { setSelected(null); return; }
    }
    if (key.downArrow && goals.length > 0) {
      const curIdx = goals.findIndex((g) => g.id === selected);
      const next = goals[Math.min(goals.length - 1, Math.max(0, curIdx >= 0 ? curIdx + 1 : 0))];
      setSelected(next.id);
      return;
    }
    if (key.upArrow && goals.length > 0) {
      const curIdx = goals.findIndex((g) => g.id === selected);
      const next = goals[Math.max(0, curIdx - 1)];
      setSelected(curIdx >= 0 ? next.id : goals[goals.length - 1].id);
      return;
    }
  });

  if (!uiStore.getState().goalsOpen) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1} marginBottom={1}>
      <Text bold color="green">Goals</Text>
      {goals.length === 0 && <Text color="gray">  (no goals)</Text>}
      {goals.map((g) => (
        <Box key={g.id} flexDirection="column" marginTop={1}>
          {selected === g.id && details ? (
            <Box flexDirection="column">
              <Text bold>{g.title}</Text>
              {details.plan && <Text color="gray">  Plan: {details.plan}</Text>}
              {details.expectedUtility !== undefined && (
                <Text color="gray">  Expected Utility: {details.expectedUtility}</Text>
              )}
              <Text color={details.priority === "HIGH" ? "yellow" : "gray"}>  Priority: {details.priority}</Text>
              {details.milestones.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  <Text color="gray">Milestones</Text>
                  {details.milestones.map((ms, i) => (
                    <Text key={i} color={ms.done ? "green" : "gray"}>
                      {ms.done ? "  ✓ " : "  ○ "}{ms.description}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          ) : (
            <Box>
              <Text color="yellow">{bar(g.progressPct)} {g.progressPct}%</Text>
              <Text color="gray">  {g.title}</Text>
            </Box>
          )}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">↑↓ select · Enter detail · Ctrl+G/Esc close</Text>
      </Box>
    </Box>
  );
}
