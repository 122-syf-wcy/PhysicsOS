/**
 * Anti-fake-official gate — a generated artefact is never an official paper.
 *
 * PhysicsOS proposes; a teacher approves. A generated paper must present itself
 * as a PhysicsOS 模拟试卷 / 非官方试卷, and anything that presents itself as
 * official (e.g. claims to be 贵州省教育厅 / 贵州省招生考试院 material, or
 * attributes the paper to such a body) is rejected here with a stable error
 * code. This is a hard gate, not a style rule: it runs before any report is
 * produced.
 */

import type { OfficialAuthority } from './sources.ts'

/** Stable error code every fake-official rejection carries. */
export const FAKE_OFFICIAL_ERROR_CODE = 'EXAM_FAKE_OFFICIAL_CLAIM' as const
export type FakeOfficialErrorCode = typeof FAKE_OFFICIAL_ERROR_CODE

/** The labels a PhysicsOS-generated paper may carry. */
export const NON_OFFICIAL_LABELS = ['PHYSICSOS_SIMULATED_PAPER', 'PHYSICSOS_UNOFFICIAL_PAPER'] as const
export type PhysicsOSPaperLabel = (typeof NON_OFFICIAL_LABELS)[number]

/** The labels an artefact may declare. The official claim is rejected below. */
export type PaperLabel = PhysicsOSPaperLabel | 'OFFICIAL_PAPER_CLAIM'

/** The mandated visible label text for each product label. */
export const PAPER_LABEL_TEXT = {
  PHYSICSOS_SIMULATED_PAPER: 'PhysicsOS 模拟试卷',
  PHYSICSOS_UNOFFICIAL_PAPER: 'PhysicsOS 非官方试卷',
  OFFICIAL_PAPER_CLAIM: '',
} satisfies Record<PaperLabel, string>

/** Whether a label is a permitted PhysicsOS non-official label. */
export const isNonOfficialLabel = (label: PaperLabel): label is PhysicsOSPaperLabel =>
  label === 'PHYSICSOS_SIMULATED_PAPER' || label === 'PHYSICSOS_UNOFFICIAL_PAPER'

/** The visible text for a permitted label. */
export const paperLabelText = (label: PhysicsOSPaperLabel): string => PAPER_LABEL_TEXT[label]

/** A body a paper is (wrongly) attributed to as its issuer. */
export interface AttributedIssuer {
  readonly authority: OfficialAuthority
  readonly name: string
}

/** A generated paper artefact submitted to the gate. */
export interface GeneratedPaperArtifact {
  readonly id: string
  readonly label: PaperLabel
  readonly attributedIssuer?: AttributedIssuer
  readonly bodyText?: string
}

/** Pass evidence: the label and the text that must be shown. */
export interface AntiFakeOfficialPass {
  readonly ok: true
  readonly label: PhysicsOSPaperLabel
  readonly displayText: string
}

/** Rejection evidence: the stable code, and what triggered it. */
export interface AntiFakeOfficialRejection {
  readonly ok: false
  readonly code: FakeOfficialErrorCode
  readonly reason: string
  readonly evidence: readonly string[]
}

export type AntiFakeOfficialResult = AntiFakeOfficialPass | AntiFakeOfficialRejection

/* Disclaimers are removed before scanning, so "非官方试卷" / "模拟试卷" never
   trip the official-claim patterns. */
const DISCLAIMER_PATTERNS: readonly RegExp[] = [
  /非官方/g,
  /不是官方/g,
  /并非官方/g,
  /非正式/g,
  /模拟(试卷|试题|题|卷)/g,
  /仿真(试卷|试题|卷)/g,
  /训练卷/g,
  /练习卷/g,
]

/* Affirmative official claims, scanned after disclaimers are stripped. */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /官方/g,
  /真题/g,
  /(教育部|教育厅|招生考试院|考试院|考试中心|命题中心)[^。！？；\n]{0,12}(命题|发布|编制|审定|印发|出品|授权)/g,
  /(命题单位|命题机构|命题人)\s*[:：]/g,
]

/**
 * Check a generated artefact for a fake-official claim.
 * @param artifact - the artefact to gate.
 * @returns pass with the mandated label text, or a rejection with the code.
 */
export function checkNotFakeOfficial(artifact: GeneratedPaperArtifact): AntiFakeOfficialResult {
  if (!isNonOfficialLabel(artifact.label)) {
    return {
      ok: false,
      code: FAKE_OFFICIAL_ERROR_CODE,
      reason: '生成物被标记为官方试卷',
      evidence: [`label=${artifact.label}`],
    }
  }
  const issuer = artifact.attributedIssuer
  if (issuer !== undefined) {
    return {
      ok: false,
      code: FAKE_OFFICIAL_ERROR_CODE,
      reason: '生成物被归因为官方机构发布',
      evidence: [`attributedIssuer=${issuer.authority}:${issuer.name}`],
    }
  }
  const evidence: string[] = []
  const text = artifact.bodyText
  if (text !== undefined) {
    let stripped = text
    for (const pattern of DISCLAIMER_PATTERNS) stripped = stripped.replace(pattern, '')
    for (const pattern of CLAIM_PATTERNS) {
      const matches = stripped.match(pattern)
      if (matches !== null) for (const match of matches) evidence.push(match.trim())
    }
  }
  if (evidence.length > 0) {
    return {
      ok: false,
      code: FAKE_OFFICIAL_ERROR_CODE,
      reason: '生成物文本包含官方试卷主张',
      evidence,
    }
  }
  return { ok: true, label: artifact.label, displayText: PAPER_LABEL_TEXT[artifact.label] }
}
