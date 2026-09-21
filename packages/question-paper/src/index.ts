/**
 * @physicsos/question-paper — the 出卷 domain model and its pure rules.
 *
 * Entities (SourcePaper, KnowledgeAnnotation, ExamBlueprint, PaperDocument,
 * ReviewRecord, ExportBundle, PaperJob), verified-structure templates,
 * mechanical draft checks, canonical version hashing, and the
 * PaperDocument→Markdown render the export chain feeds pandoc.
 *
 * `bank.ts` / `compose.ts` / `knowledge-weights.ts` are draft-scaffolding
 * from the earlier sampler spike — intentionally NOT re-exported here; they
 * carry unverified data and are not a production path.
 */

export * from './paper.ts'
export * from './assemble.ts'
export * from './blueprints.ts'
export * from './checks.ts'
export * from './difficulty.ts'
export * from './export-markdown.ts'
export * from './versioning.ts'
