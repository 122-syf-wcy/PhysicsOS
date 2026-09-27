/**
 * Paper planning — the runtime refuses to build a paper it cannot govern.
 *
 * Planning resolves the profile and then reads the blueprint *from that
 * profile*: total score, duration, section question counts and scoring all come
 * from data, never from a constant in the engine and never from the model. If
 * the profile is unconfirmed, or its blueprint is incomplete, planning returns
 * an explicit `REFUSED` state with the reason — it does not default, and it
 * does not invent a Guizhou structure.
 */

import { paperLabelText, type PhysicsOSPaperLabel } from './anti-fake-official.ts'
import {
  blueprintQuestionCount,
  sectionScore,
  type CoverageConstraint,
  type DifficultyDistribution,
} from './blueprint.ts'
import { packIdentity } from './pack.ts'
import { profileIssues, type ProfileTarget } from './profile.ts'
import type { ExamStandardRegistry, UnconfirmedCode } from './registry.ts'
import type { QuestionType } from './taxonomy.ts'

/** The label every PhysicsOS-generated paper carries by default. */
export const DEFAULT_PAPER_LABEL: PhysicsOSPaperLabel = 'PHYSICSOS_SIMULATED_PAPER'

/** Why planning refused to build a paper. */
export type PlanRefusalCode = UnconfirmedCode | 'PROFILE_INVALID' | 'NO_SECTIONS'

/** One planned section (derived wholly from the profile blueprint). */
export interface PaperPlanSection {
  readonly id: string
  readonly title: string
  readonly questionCount: number
  readonly taxonomy: readonly QuestionType[]
  readonly totalScore: number
}

/** A paper the runtime is willing to build, sourced from the active profile. */
export interface PaperPlan {
  readonly profileId: string
  readonly packIdentity: string
  readonly target: ProfileTarget
  readonly label: PhysicsOSPaperLabel
  readonly labelText: string
  readonly totalScore: number
  readonly durationMinutes: number
  readonly questionCount: number
  readonly sections: readonly PaperPlanSection[]
  readonly coverageConstraints: readonly CoverageConstraint[]
  readonly difficultyDistribution: DifficultyDistribution
  readonly maxDuplicateModelRatio: number
}

/** Planning outcome. */
export type PaperPlanResult =
  | { readonly status: 'READY'; readonly plan: PaperPlan }
  | {
      readonly status: 'REFUSED'
      readonly code: PlanRefusalCode
      readonly reason: string
      readonly requested: ProfileTarget
    }

/**
 * Plan a paper for a target against a registry.
 * @param registry - the pack registry to resolve against.
 * @param query - the four-part exam target.
 * @returns a READY plan sourced from the resolved profile, or a REFUSED state.
 */
export function planPaper(
  registry: ExamStandardRegistry,
  query: ProfileTarget,
): PaperPlanResult {
  const resolution = registry.resolve(query)
  if (resolution.status === 'UNCONFIRMED') {
    return { status: 'REFUSED', code: resolution.code, reason: resolution.reason, requested: query }
  }
  const { profile, pack } = resolution
  const issues = profileIssues(profile)
  if (issues.length > 0) {
    return { status: 'REFUSED', code: 'PROFILE_INVALID', reason: issues.join('；'), requested: query }
  }
  const blueprint = profile.paperBlueprint
  if (blueprint.sections.length === 0) {
    return { status: 'REFUSED', code: 'NO_SECTIONS', reason: '蓝图没有分卷', requested: query }
  }
  const sections = blueprint.sections.map((section) => ({
    id: section.id,
    title: section.title,
    questionCount: section.questionCount,
    taxonomy: section.taxonomy,
    totalScore: sectionScore(section),
  }))
  const plan: PaperPlan = {
    profileId: profile.id,
    packIdentity: packIdentity(pack),
    target: {
      jurisdiction: profile.jurisdiction,
      stage: profile.stage,
      subject: profile.subject,
      year: profile.year,
    },
    label: DEFAULT_PAPER_LABEL,
    labelText: paperLabelText(DEFAULT_PAPER_LABEL),
    totalScore: blueprint.totalScore,
    durationMinutes: blueprint.durationMinutes,
    questionCount: blueprintQuestionCount(blueprint),
    sections,
    coverageConstraints: blueprint.coverageConstraints,
    difficultyDistribution: blueprint.difficultyDistribution,
    maxDuplicateModelRatio: blueprint.maxDuplicateModelRatio,
  }
  return { status: 'READY', plan }
}
