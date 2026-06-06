export type CompilationPhase = "PARSE" | "RESOLVE" | "DAG" | "MAPPING"

export class CompilationError extends Error {
  constructor(
    message: string,
    public readonly phase: CompilationPhase,
    public readonly stepId?: string
  ) {
    super(message)
    this.name = "CompilationError"
  }
}
