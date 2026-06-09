import { EventEmitter } from "node:events"
import { getDueSchedules, claimSchedule, recordRun, releaseSchedule } from "./scheduler-store.js"
import type { BuilderService } from "./builder-service.js"

export interface SchedulerEvents {
  tick: (schedulesCount: number) => void
  execute: (scheduleId: string, workflowId: string, runId: string) => void
  scheduleError: (scheduleId: string, error: string) => void
  started: () => void
  stopped: () => void
}

export declare interface WorkflowScheduler {
  on<U extends keyof SchedulerEvents>(event: U, listener: SchedulerEvents[U]): this
  emit<U extends keyof SchedulerEvents>(event: U, ...args: Parameters<SchedulerEvents[U]>): boolean
}

export class WorkflowScheduler extends EventEmitter {
  private intervalMs: number
  private builder: BuilderService
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private db?: any

  constructor(builder: BuilderService, intervalMs: number = 15000, db?: any) {
    super()
    this.builder = builder
    this.intervalMs = intervalMs
    this.db = db
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    this.emit("started")
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.emit("stopped")
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      const due = getDueSchedules(this.db)
      this.emit("tick", due.length)
      for (const schedule of due) {
        if (!this.running) break
        await this.executeSchedule(schedule)
      }
    } catch (err) {
      this.emit("scheduleError", "", String(err))
    }
  }

  private async executeSchedule(schedule: { id: string; workflowId: string }): Promise<void> {
    if (!claimSchedule(schedule.id, 30000, this.db)) return
    try {
      const result = await this.builder.execute(schedule.workflowId, {})
      if (result.success) {
        recordRun(schedule.id, true, undefined, this.db)
        this.emit("execute", schedule.id, schedule.workflowId, result.runId)
      } else {
        recordRun(schedule.id, false, result.error, this.db)
        this.emit("scheduleError", schedule.id, result.error ?? "unknown error")
      }
    } catch (err) {
      recordRun(schedule.id, false, String(err), this.db)
      releaseSchedule(schedule.id, this.db)
      this.emit("scheduleError", schedule.id, String(err))
    }
  }
}
