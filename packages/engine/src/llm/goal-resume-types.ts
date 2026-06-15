import type { Goal as PersistedGoal, GoalPlan as PersistedGoalPlan, Milestone as PersistedMilestone } from "@arelyos/persistence";

export type ResumeGoal = PersistedGoal;
export type ResumeGoalPlan = PersistedGoalPlan;
export type ResumeMilestone = PersistedMilestone;

export interface PrioritizedMilestone {
  milestoneId: string
  goalId: string
  planId: string
  utility: number
  description: string
}

export interface ResumeContext {
  activeGoals: ResumeGoal[]
  plans: ResumeGoalPlan[]
  milestones: ResumeMilestone[]
  prioritizedMilestones: PrioritizedMilestone[]
}
