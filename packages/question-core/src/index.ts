export type {
  QuestionSource,
  QuestionContentStatus,
  QuestionContent,
  QuestionMetadata,
  QuestionDocument,
} from './question-document.ts'
export type {
  MagneticModelId,
  ElectricModelId,
  PhysicsModelId,
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
export type { QuestionSolutionStep, QuestionSolutionResult, QuestionSolution, QuestionDiagnostic } from './question-solution.ts'
export type { QuestionWorkflowState } from './workflow.ts'
export type { QuestionParseCandidate, QuestionParserProvider, QuestionParserResult } from './question-parser.ts'
export type { SceneBuildResult } from './scene-builder.ts'
export type { ElectricSceneBuildResult } from './electric-scene-builder.ts'
export type { EngineSelectionResult } from './engine-selector.ts'
export type { QuestionRuntimeResult } from './question-runtime.ts'
export type { QuestionIngestProvider, IngestProviderStatus } from './question-ingest.ts'
export { TextIngestProvider, StubImageIngestProvider, StubPdfIngestProvider, DEFAULT_INGEST_PROVIDERS } from './question-ingest.ts'
export { DeterministicMagneticQuestionParser } from './deterministic-magnetic-parser.ts'
export { DeterministicMechanicsQuestionParser } from './deterministic-mechanics-parser.ts'
export {
  DeterministicElectricQuestionParser,
  isElectricQuestionText,
} from './deterministic-electric-parser.ts'
export { validateSemanticIR } from './semantic-validator.ts'
export { buildSceneFromIR } from './scene-builder.ts'
export { buildElectricSceneFromIR, buildParallelPlateSceneFromIR } from './electric-scene-builder.ts'
export { selectEngine } from './engine-selector.ts'
export { processQuestion } from './question-runtime.ts'
export { GOLDEN_QUESTIONS, createGoldenQuestionDocument } from './golden-questions.ts'
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
