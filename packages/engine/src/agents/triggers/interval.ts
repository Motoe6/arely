export interface IntervalTriggerConfig {
  intervalMs: number;
}

export function parseIntervalConfig(raw: string | null): IntervalTriggerConfig | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IntervalTriggerConfig;
  } catch {
    return null;
  }
}

export function isTriggerDue(
  intervalMs: number,
  lastRunAt: number | null,
  now: number = Date.now(),
): boolean {
  if (lastRunAt === null) return true;
  return now - lastRunAt >= intervalMs;
}
