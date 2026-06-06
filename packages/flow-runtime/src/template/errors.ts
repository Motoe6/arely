export type TemplateErrorReason =
  | "INVALID_SOURCE"
  | "INVALID_EXPRESSION"
  | "STEP_NOT_RESOLVED"
  | "PATH_NOT_FOUND"
  | "NULL_REFERENCE"
  | "SECRET_NOT_FOUND"

export class TemplateResolutionError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly reason: TemplateErrorReason
  ) {
    super(message)
    this.name = "TemplateResolutionError"
  }
}
