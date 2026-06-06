export type ManualTriggerConfig = Record<string, never>;

export function isManualTrigger(): boolean {
  return true;
}
