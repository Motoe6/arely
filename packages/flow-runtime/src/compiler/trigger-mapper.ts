import type { TriggerDef } from "../types.js"

export interface MappedTrigger {
  type: string
  source: string
  config: Record<string, unknown> | undefined
}

export function mapTrigger(trigger: TriggerDef | undefined): MappedTrigger | undefined {
  if (!trigger) return undefined

  switch (trigger.type) {
    case "webhook":
      return { type: "event", source: "http", config: trigger.config }
    case "interval":
      return { type: "event", source: "cron", config: trigger.config }
    case "manual":
      return { type: "event", source: "manual", config: trigger.config }
    case "event":
      return { type: "event", source: "event", config: trigger.config }
  }
}
