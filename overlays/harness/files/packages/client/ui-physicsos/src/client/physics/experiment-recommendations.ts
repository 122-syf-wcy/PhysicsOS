/**
 * Experiment recommendations for the library home.
 *
 * Pure selection over two honest inputs: the student's own learning record
 * (self-check attempts → weak knowledge nodes → the experiment that trains
 * each node) and a curated classic set for students with no record yet. No
 * model call and no telemetry — the reason shown on a card is exactly the rule
 * that picked it.
 */

import type { StudentAttempt } from '../learning-record-store.ts'
import { knowledgeMasteryOf } from '../learning-record-store.ts'
import {
  findExperimentTemplate,
  type ExperimentTemplate,
} from './experiment-templates.ts'

/** Why a template is on the recommendation rail. */
export type RecommendationReason = 'weakness' | 'classic'

export interface ExperimentRecommendation {
  readonly template: ExperimentTemplate
  readonly reason: RecommendationReason
  /** The weak knowledge node that selected this template; weakness picks only. */
  readonly nodeId?: string
}

/**
 * Knowledge node → the experiment template that trains it. Hand-audited like
 * QUESTION_KNOWLEDGE: a node maps to the one template whose apparatus IS the
 * node's model, and nodes with no honest experiment (单位与数量级, subject
 * roots) are deliberately absent rather than mapped to something adjacent.
 */
export const KNOWLEDGE_EXPERIMENT: Readonly<Record<string, string>> = {
  'kin-average-speed': 'average-speed',
  'kin-uniform-acceleration': 'uniform-acceleration',
  'kin-projectile': 'projectile-horizontal',
  'dyn-newton-second': 'newton-second-law',
  'dyn-force-analysis': 'newton-second-law',
  'dyn-incline': 'incline',
  'em-field-strength': 'point-charge',
  'em-superposition': 'multi-point-charge',
  'em-electric-force': 'uniform-electric',
  'em-uniform-deflection': 'parallel-plate',
  'em-bounded-field': 'parallel-plate',
  'em-energy': 'parallel-plate',
  'em-lorentz': 'magnetic-circular',
  'em-circular': 'magnetic-circular',
  'em-crossed-fields': 'composite-eb',
  'em-velocity-selector': 'velocity-selector',
  'em-mass-spectrometer': 'mass-spectrometer',
  'em-three-field': 'composite-ebg',
  'circ-ohm-law': 'va-resistance',
  'circ-series': 'series-circuit',
  'circ-parallel': 'parallel-circuit',
  'circ-dynamic': 'rheostat-circuit',
  'circ-power': 'bulb-power',
  'circ-emf-internal': 'emf-measurement',
  'opt-light-reflection': 'plane-mirror',
  'opt-plane-mirror': 'plane-mirror',
  'opt-lens-imaging': 'convex-lens',
  'opt-curved-mirror': 'concave-mirror',
  /* 实像与虚像 trains on the lens: sweeping u across f shows BOTH natures,
     where the plane mirror only ever shows a virtual image. */
  'opt-real-virtual-image': 'convex-lens',
  /* All three acoustics nodes train on the one echo rig: the propagation node
     is the medium switch, the echo node is the reflection event, the ranging
     node is the d = v·t/2 measurement itself. */
  'ac-sound-propagation': 'echo-ranging',
  'ac-echo': 'echo-ranging',
  'ac-echo-ranging': 'echo-ranging',
}

/**
 * The curated fallback, one representative experiment per domain in 力 → 电 →
 * 磁 → 复合 order, so a brand-new student sees the whole subject map.
 */
export const CLASSIC_EXPERIMENT_IDS: readonly string[] = [
  'projectile-horizontal',
  'parallel-plate',
  'magnetic-circular',
  'velocity-selector',
]

export interface RecommendationInput {
  /** The student's self-check history (newest first, as the record stores it). */
  readonly attempts: readonly Pick<StudentAttempt, 'correct' | 'knowledge'>[]
  /**
   * Template ids to keep OFF the classic fill — typically the 最近使用 rail,
   * so discovery cards do not repeat what the student just ran. Weakness picks
   * ignore this: targeted re-practice is the point even when recent.
   */
  readonly excludeClassicIds?: readonly string[]
  readonly limit?: number
}

/**
 * Pick the recommendation rail: weakness-targeted experiments first (most
 * wrong answers, then lowest accuracy), classics filling the rest. Duplicates,
 * unknown mappings and 即将支持 templates are dropped, so the result is always
 * directly creatable.
 */
export function recommendExperiments({
  attempts,
  excludeClassicIds = [],
  limit = 3,
}: RecommendationInput): readonly ExperimentRecommendation[] {
  const picks: ExperimentRecommendation[] = []
  const taken = new Set<string>()

  const add = (templateId: string, reason: RecommendationReason, nodeId?: string): void => {
    if (taken.has(templateId)) return
    const template = findExperimentTemplate(templateId)
    if (template === undefined || template.comingSoon === true) return
    taken.add(templateId)
    picks.push({ template, reason, ...(nodeId === undefined ? {} : { nodeId }) })
  }

  const weakNodes = knowledgeMasteryOf(attempts)
    .filter(node => node.correct < node.total)
    .sort((a, b) =>
      (b.total - b.correct) - (a.total - a.correct)
      || a.correct / a.total - b.correct / b.total)
  for (const node of weakNodes) {
    if (picks.length >= limit) break
    const templateId = KNOWLEDGE_EXPERIMENT[node.nodeId]
    if (templateId === undefined) continue
    add(templateId, 'weakness', node.nodeId)
  }

  const excluded = new Set(excludeClassicIds)
  for (const id of CLASSIC_EXPERIMENT_IDS) {
    if (picks.length >= limit) break
    if (excluded.has(id)) continue
    add(id, 'classic')
  }

  return picks
}
