export type {
  QuestionSource,
  QuestionContentStatus,
  QuestionContent,
  QuestionMetadata,
  QuestionDocument,
} from './question-document.ts'
export type {
  MagneticModelId,
  OpticsModelId,
  ElectricModelId,
  PhysicsModelId,
  CircuitModelId,
  InductionModelId,
  WaveModelId,
  ModernPhysicsModelId,
  SemanticEntity,
  SemanticTarget,
  SemanticRelation,
  SemanticAssumption,
  PlanarDirection,
  KnownValue,
  UnknownValue,
  QuestionConstraint,
  PhysicsSemanticIR,
  ValidationResultStatus,
  QuestionParseIssue,
  QuestionAmbiguity,
  SemanticValidationResult,
} from './semantic-ir.ts'
export type {
  QuestionSolutionStep,
  QuestionSolutionResult,
  QuestionSolution,
  QuestionDiagnostic,
} from './question-solution.ts'
export { substitutionFor, attachSubstitutions } from './solution-substitution.ts'
export type { QuestionWorkflowState } from './workflow.ts'
export type {
  QuestionParseCandidate,
  QuestionParserProvider,
  QuestionParserResult,
} from './question-parser.ts'
export type { SceneBuildResult } from './scene-builder.ts'
export type { ElectricSceneBuildResult } from './electric-scene-builder.ts'
export type { EngineSelectionResult } from './engine-selector.ts'
export type { QuestionRuntimeResult } from './question-runtime.ts'
export type {
  QuestionIngestProvider,
  IngestProviderStatus,
  UploadedQuestionProvenance,
} from './question-ingest.ts'
export {
  TextIngestProvider,
  StubImageIngestProvider,
  StubPdfIngestProvider,
  DEFAULT_INGEST_PROVIDERS,
  createUploadedQuestionDocument,
} from './question-ingest.ts'
export { DeterministicMagneticQuestionParser } from './deterministic-magnetic-parser.ts'
export { DeterministicMechanicsQuestionParser } from './deterministic-mechanics-parser.ts'
export {
  DeterministicElectricQuestionParser,
  isElectricQuestionText,
} from './deterministic-electric-parser.ts'
export {
  DeterministicOpticsQuestionParser,
  isOpticsQuestionText,
} from './deterministic-optics-parser.ts'
export { validateSemanticIR } from './semantic-validator.ts'
export { buildSceneFromIR } from './scene-builder.ts'
export {
  buildElectricSceneFromIR,
  buildParallelPlateSceneFromIR,
} from './electric-scene-builder.ts'
export { buildOpticsSceneFromIR } from './optics-scene-builder.ts'
export type { OpticsSceneBuildResult } from './optics-scene-builder.ts'
export {
  DeterministicCircuitQuestionParser,
  isCircuitQuestionText,
} from './deterministic-circuit-parser.ts'
export { buildCircuitSceneFromIR } from './circuit-scene-builder.ts'
export type { CircuitSceneBuildResult } from './circuit-scene-builder.ts'
export {
  DeterministicInductionQuestionParser,
  isInductionQuestionText,
} from './deterministic-induction-parser.ts'
export { buildInductionSceneFromIR } from './induction-scene-builder.ts'
export type { InductionSceneBuildResult } from './induction-scene-builder.ts'
export {
  DeterministicWaveQuestionParser,
  detectMechanicalWaveModel,
  isWaveQuestionText,
} from './deterministic-wave-parser.ts'
export { buildWaveSceneFromIR } from './wave-scene-builder.ts'
export type { WaveSceneBuildResult } from './wave-scene-builder.ts'
export {
  DeterministicModernPhysicsQuestionParser,
  isModernPhysicsQuestionText,
} from './deterministic-modern-parser.ts'
export { buildModernPhysicsSceneFromIR } from './modern-scene-builder.ts'
export type { ModernSceneBuildResult } from './modern-scene-builder.ts'
export { selectEngine } from './engine-selector.ts'
export { processQuestion } from './question-runtime.ts'
export {
  GOLDEN_QUESTIONS,
  MODERN_GOLDEN_QUESTIONS,
  createGoldenQuestionDocument,
  goldenQuestionDomain,
} from './golden-questions.ts'
export type { GoldenQuestionDefinition } from './golden-questions.ts'
export {
  KNOWLEDGE_NODES,
  QUESTION_KNOWLEDGE,
  knowledgeNodeOf,
  knowledgeNodesOfQuestion,
} from './knowledge-graph.ts'
export type { KnowledgeDomain, KnowledgeNode } from './knowledge-graph.ts'
export { QUESTION_SELF_CHECKS, selfChecksOfQuestion } from './self-checks.ts'
export type {
  MistakeType,
  SelfCheckItem,
  SelfCheckMistake,
  SelfCheckOption,
} from './self-checks.ts'
export { EXPERIMENT_SELF_CHECKS, experimentSelfChecksOfTopic } from './experiment-self-checks.ts'
export type { ExperimentSelfCheckSet } from './experiment-self-checks.ts'
