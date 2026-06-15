export type {
  TemplateParamType, TemplateSource,
  TemplateParameter, TemplateMetadata, Template,
  TemplateRegistryLike,
  ParameterRecommendation, ParameterRecommendationsResult, ParameterRecommenderLike,
  ParameterValueInsight, ParameterInsight, ParameterInsightsResult, ParameterEffectivenessLike,
} from "./types.js";

export type { EvolutionProposal, EvolutionProposalsResult, EvidenceSnapshot, EvolutionAuditRecord } from "./evolution-types.js";

export { EvolutionProposalService } from "./evolution-proposal-service.js";
export type { ApplyProposalResult } from "./template-evolution-service.js";
export { TemplateEvolutionError, TemplateEvolutionService } from "./template-evolution-service.js";

export type {
  StructuralPattern, StructuralFeature, StructuralPatternMatch, StructuralInsight, StructuralInsightsResult,
} from "./structural-pattern-types.js";
export type { StructuralEvolutionKind, StructuralEvolutionProposal } from "./structural-evolution-types.js";
export { StructuralAnalyzer } from "./structural-analyzer.js";
export { StructuralInsightsService } from "./structural-insights-service.js";
export { StructuralEvolutionProposalService } from "./structural-evolution-proposal-service.js";
export type { StructuralApplyResult } from "./structural-evolution-service.js";
export { StructuralEvolutionError, StructuralEvolutionService } from "./structural-evolution-service.js";
export { StructuralProposalService } from "./structural-proposal-service.js";
