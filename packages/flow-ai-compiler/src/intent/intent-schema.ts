import { z } from "zod"

export const IntentTriggerSchema = z.object({
  type: z.enum(["webhook", "schedule", "manual", "event"]),
  description: z.string(),
  inferred: z.boolean().optional(),
})

export const IntentStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  intent: z.string(),
  dependencies: z.array(z.string()).optional(),
  inputHints: z.object({
    source: z.string().optional(),
    key: z.string().optional(),
  }).optional(),
  typeHint: z.string().optional(),
})

export const IntentConstraintsSchema = z.object({
  maxSteps: z.number().optional(),
  allowLoops: z.literal(false),
  allowParallel: z.boolean().optional(),
  requiresDeterminism: z.literal(true),
})

export const WorkflowIntentSchema = z.object({
  goal: z.string().min(1),
  triggers: z.array(IntentTriggerSchema),
  steps: z.array(IntentStepSchema),
  constraints: IntentConstraintsSchema,
})

export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>
export type IntentTrigger = z.infer<typeof IntentTriggerSchema>
export type IntentStep = z.infer<typeof IntentStepSchema>
