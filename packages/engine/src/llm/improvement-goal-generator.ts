import type { SelfAssessment, AssessmentDimension } from "./self-assessment-types.js";
import type { ImprovementGenerationResult, GeneratedImprovement } from "./improvement-generator-types.js";
import { GoalService, goalService as defaultGoalService } from "./goal-service.js";
import { PlanningService, planningService as defaultPlanningService } from "./planning-service.js";

const MILESTONE_TEMPLATES: Record<string, string[]> = {
  strategy: [
    "Analyze recent failures and identify root causes",
    "Design and implement targeted improvements",
    "Validate improvements with test executions",
  ],
  model: [
    "Audit failure patterns and edge cases",
    "Research alternative model configurations or replacements",
    "Implement and validate model improvement",
  ],
  prediction: [
    "Audit calibration data and identify bias patterns",
    "Adjust prediction parameters to reduce bias",
    "Validate improved calibration accuracy",
  ],
  goal_progress: [
    "Review and refine goal scope and objectives",
    "Break goal into actionable milestones with clear criteria",
    "Execute first milestone and establish progress cadence",
  ],
  reasoning: [
    "Analyze reasoning failure patterns",
    "Design improved reasoning approach",
    "Test and validate reasoning improvements",
  ],
};

function getMilestonesFor(dimension: string, label: string): string[] {
  const templates = MILESTONE_TEMPLATES[dimension] ?? MILESTONE_TEMPLATES.reasoning;
  return templates.map((t) => `${t} for "${label}"`);
}

export { type ImprovementGenerationResult, type GeneratedImprovement } from "./improvement-generator-types.js";

export class ImprovementGoalGenerator {
  private goalService: GoalService;
  private planningService: PlanningService;

  constructor(deps?: {
    goalService?: GoalService
    planningService?: PlanningService
  }) {
    this.goalService = deps?.goalService ?? defaultGoalService;
    this.planningService = deps?.planningService ?? defaultPlanningService;
  }

  generate(assessment: SelfAssessment, options?: { maxGoals?: number }): ImprovementGenerationResult {
    const improvements: GeneratedImprovement[] = [];
    const max = options?.maxGoals ?? assessment.recommendations.length;
    const toProcess = assessment.recommendations.slice(0, max);

    for (const rec of toProcess) {
      const goal = this.goalService.createGoal({
        title: rec.label,
        description: rec.description,
        priority: 5,
        metadata: { source: "self-assessment", dimension: rec.dimension, expectedImpact: rec.expectedImpact },
      });

      const plan = this.planningService.createGoalPlan({
        goalId: goal.id,
        title: `${rec.label} — Plan`,
        description: `Implementation plan for: ${rec.description}`,
      });

      const descriptions = getMilestonesFor(rec.dimension, rec.label);
      const milestones = descriptions.map((desc) =>
        this.planningService.createMilestone({ planId: plan.id, description: desc })
      );

      improvements.push({ recommendationLabel: rec.label, dimension: rec.dimension, goal, plan, milestones });
    }

    return {
      improvements,
      totalCreated: improvements.length,
      summary: improvements.length > 0
        ? `Created ${improvements.length} improvement goal(s): ${improvements.map((i) => i.goal.title).join(", ")}`
        : "No improvements generated — no recommendations to act on",
    };
  }
}

export const improvementGoalGenerator = new ImprovementGoalGenerator();
