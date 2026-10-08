/**
 * @physicsos/exam-standard — the Exam Standard Runtime.
 *
 * The project's third moat: a generated paper is not the model "feeling like" a
 * Guizhou paper, but is governed by versioned official standards. It provides:
 *
 *  - the contracts ({@link ExamProfile}, {@link PaperBlueprint},
 *    {@link QuestionTaxonomy}, {@link CompetencyModel}, {@link AnswerStandard},
 *    {@link ScoringStandard}, {@link OfficialSourceRef}) keyed by
 *    `(jurisdiction, stage, subject, year)`, with 中考 and 高考 as entirely
 *    separate profiles;
 *  - profile resolution over a pack registry that ships with **no populated
 *    real pack** — resolution and paper planning return explicit
 *    `UNCONFIRMED` / `REFUSED` states rather than defaulting;
 *  - the {@link verifyExamCompliance} Exam Compliance Verifier, distinct from
 *    the Physics Verifier, producing an {@link ExamComplianceReport} that ends
 *    at `READY_FOR_TEACHER_REVIEW`;
 *  - the anti-fake-official gate ({@link checkNotFakeOfficial}, code
 *    {@link FAKE_OFFICIAL_ERROR_CODE}).
 *
 * Extension is by data: adding another province or the national 新高考 is a new
 * versioned {@link ExamStandardPack}, never a branch in this engine.
 */

export * from './validate.ts'
export * from './sources.ts'
export * from './taxonomy.ts'
export * from './competency.ts'
export * from './answer.ts'
export * from './scoring.ts'
export * from './question.ts'
export * from './blueprint.ts'
export * from './content-scope.ts'
export * from './profile.ts'
export * from './pack.ts'
export * from './registry.ts'
export * from './plan.ts'
export * from './anti-fake-official.ts'
export * from './compliance.ts'
