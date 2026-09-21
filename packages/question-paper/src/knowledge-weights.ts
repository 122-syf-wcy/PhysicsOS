/**
 * Guizhou knowledge-point weights — the hand-entered 考点表 the compose
 * sampler draws against.
 *
 * 中考 weights come from the 2023–2025 真题 split (力学 ≈39%, 电学 ≈31%,
 * 热学 ≈11%, 光学 ≈10%, 声学 ≈3%, 能源与微观 ≈6%) mapped onto the
 * knowledge-graph domains; `fluid` carries the 浮力 share inside 力学.
 * 高考 weights follow the selective-exam pattern: 力学、电磁学 the trunk,
 * 热/光/原子/机械波 the rotating modules.
 *
 * `rotation` flags the audit-tracked 轮换考点 (凸透镜成像隔年、伏安法高频):
 * mock papers boost rotated-in topics so prediction papers track the real
 * alternation instead of a flat frequency.
 */

import type { PaperLevel } from './paper.ts'

/** Domain → sampling weight for one level. */
export type KnowledgeWeights = Readonly<Record<string, number>>

export const ZHONGKAO_WEIGHTS: KnowledgeWeights = {
  mechanics: 0.3,
  fluid: 0.09,
  circuit: 0.22,
  electromagnetism: 0.09,
  thermal: 0.11,
  optics: 0.1,
  acoustics: 0.03,
  energy: 0.06,
}

export const GAOKAO_WEIGHTS: KnowledgeWeights = {
  mechanics: 0.4,
  electromagnetism: 0.28,
  circuit: 0.05,
  thermal: 0.08,
  optics: 0.08,
  wave: 0.04,
  atomic: 0.07,
}

/** Domains whose 考点 the mock paper should boost (轮换回归年). */
const ROTATION_BOOST: Readonly<Record<PaperLevel, readonly string[]>> = {
  /* 2026 轮换预测: 凸透镜成像、热值计算、伏安法回归概率高. */
  zhongkao: ['optics', 'thermal', 'circuit'],
  gaokao: ['optics', 'wave'],
}

/**
 * Sampling weights for a level; mock papers apply the rotation boost.
 * @param level - exam track.
 * @param mock - true for the 模拟预测卷.
 * @returns domain → weight; untouched domains keep their base weight.
 */
export function weightsFor(level: PaperLevel, mock: boolean): KnowledgeWeights {
  const base = level === 'zhongkao' ? ZHONGKAO_WEIGHTS : GAOKAO_WEIGHTS
  if (!mock) return base
  const boosted: Record<string, number> = { ...base }
  for (const domain of ROTATION_BOOST[level]) {
    const weight = boosted[domain]
    if (weight !== undefined) boosted[domain] = weight * 1.3
  }
  return boosted
}
