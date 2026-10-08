# @physicsos/exam-standard

The **Exam Standard Runtime**: the contract core that makes a generated paper
governed by versioned official standards rather than the language model
"feeling like" a Guizhou paper. It is the project's third moat, alongside the
physics world runtime and the question compiler.

This package ships **contracts and machinery only**. It contains **no populated
real pack** — no Guizhou paper structure, question count, score split,
difficulty number, rubric or source metadata. Populating Guizhou 2026 later is a
data task driven by official documents; extension to another province or the
national 新高考 is a new versioned pack, never a branch in this engine.

## Versioning — never a single boolean

```
CN → Guizhou → { 中考 | 高考 } → { 2024 | 2025 | 2026 … }
```

A profile is keyed by `(jurisdiction, stage, subject, year)`. 中考 and 高考 are
**entirely separate profiles** (different curriculum roots; no shared template
with a difficulty switch). The governor of what may be asked is the
**考试范围 / Curriculum Scope** (`ContentScope`) — never a 考试大纲.

## Contracts

`ExamProfile`, `PaperBlueprint`, `ContentScope`, `QuestionTaxonomy`,
`CompetencyModel`, `AnswerStandard`, `ScoringStandard`, `OfficialSourceRef`,
`QuestionRecord`, and the three distinct answer levels (`FinalAnswer`,
`ExamSolution`, `LearningExplanation`) with structured `ScoringPoint`s.

## Resolution and the unconfirmed state

```ts
import { createExamStandardRegistry, planPaper, examStandardRegistry } from '@physicsos/exam-standard'

const registry = createExamStandardRegistry()          // empty: no real pack
registry.resolve({ jurisdiction: 'CN-GZ', stage: 'ZHONGKAO', subject: 'PHYSICS', year: 2026 })
// → { status: 'UNCONFIRMED', code: 'NO_PACK_REGISTERED', … }   // never a default

planPaper(registry, target) // → { status: 'REFUSED', code, reason }  // never guesses
```

An unconfirmed profile, an incomplete blueprint or an ambiguous target produce
an explicit `UNCONFIRMED` / `REFUSED` state with a stable code. The runtime that
guesses official norms is worse than one that refuses.

## Two verifiers, kept distinct

- `@physicsos/physics-verifier` → *is the physics right?* (not this package)
- `verifyExamCompliance` → *is this in scope, a valid type, a valid score, a
  valid answer format, within the difficulty target, and does it satisfy
  blueprint coverage?*

The exam verifier consumes the physics verifier's `PhysicsVerificationSummary`
structurally (so the dependency stays out) and merely echoes the physics result
count; it does not adjudicate physics. Its `ExamComplianceReport` ends at
`READY_FOR_TEACHER_REVIEW` — the system proposes, a teacher approves. It never
ends at "official".

## Anti-fake-official gate

`checkNotFakeOfficial` requires every generated artefact to be labelled a
PhysicsOS 模拟试卷 / 非官方试卷 and rejects anything presenting itself as
official (an `OFFICIAL_PAPER_CLAIM` label, attribution to a real authority, or
body text claiming official issuance) with the stable code
`EXAM_FAKE_OFFICIAL_CLAIM`.

## Tests

```sh
pnpm -C packages/exam-standard test        # vitest
pnpm -C packages/exam-standard typecheck   # tsc --noEmit
pnpm -C packages/exam-standard lint        # eslint
```

Tests use clearly-labelled synthetic fixtures (`TEST-FIXTURE-*`, `.invalid`
URLs) and assert the honest failure mode: with no confirmed profile/sources,
resolution and planning refuse rather than default.
