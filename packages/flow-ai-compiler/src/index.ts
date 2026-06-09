// Legacy exports (phase 0 — stable)
export { compilePrompt, processLLMOutput, buildPrompt } from "./compiler.js"
export type { LLMAdapter, CompilePromptOptions } from "./compiler.js"
export { assertValidWorkflow, AICompilerError } from "./schema.js"
export type { LLMWorkflowOutput } from "./schema.js"
export { validateWorkflow, assertValidWorkflowOrThrow } from "./validator.js"
export { FEW_SHOT_EXAMPLES } from "./examples.js"

// LLM Adapter layer
export type { CompilerLLMAdapter } from "./llm/adapter.js"
export { createLocalAdapter } from "./llm/local-adapter.js"
export type { LocalAdapterConfig } from "./llm/local-adapter.js"
export { createRemoteAdapter } from "./llm/remote-adapter.js"
export type { RemoteAdapterConfig } from "./llm/remote-adapter.js"
export { createCompilerLLM } from "./llm/factory.js"
export type { CompilerLLMConfig } from "./llm/factory.js"

// Config
export { CompilerConfigSchema, loadCompilerConfig } from "./config.js"
export type { CompilerConfig } from "./config.js"

// Intent layer (B.1)
export { WorkflowIntentSchema, IntentTriggerSchema, IntentStepSchema, IntentConstraintsSchema } from "./intent/intent-schema.js"
export type { WorkflowIntent, IntentTrigger, IntentStep } from "./intent/intent-schema.js"
export { createExtractor, IntentExtractionError } from "./intent/intent-extractor.js"
export { validateIntent, enforceConstraints, IntentValidationError } from "./intent/intent-validator.js"
export { INTENT_SYSTEM_PROMPT, buildIntentPrompt } from "./llm/prompt-to-intent.js"

// Selector layer (B.2)
export type { MatchStrategy, SelectorMetadata, SelectableNode, NodeMatch, ResolvedStep } from "./selector/types.js"
export { selectNodes } from "./selector/node-selector.js"
export { scoreStep, pickBest, NodeSelectionError } from "./selector/score-engine.js"
export { deriveMetadata, registerCustomKeywords } from "./selector/keywords.js"

// DAG Builder (B.3)
export { buildDag, DagBuildError } from "./compiler/dag-builder.js"
export { compileFromPrompt, CompilePipelineError } from "./compiler/compile-pipeline.js"
export type { CompileResult, CompileDiagnostic, CompileFromPromptOptions } from "./compiler/compile-pipeline.js"
