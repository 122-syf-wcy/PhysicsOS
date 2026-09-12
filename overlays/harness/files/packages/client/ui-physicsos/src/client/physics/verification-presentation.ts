/**
 * Student-facing presentation of engine verification and derived quantities.
 *
 * Every domain runtime publishes the engine's full check list. Roughly half of
 * those checks are structural preconditions (schema version, unique ids, unit
 * dimensions) that the scene factories always satisfy — they matter to a
 * developer, but to a student they read as a wall of `scene_schema_version`
 * identifiers that hide the physical laws the panel exists to show. This module
 * is the single place that decides what a student sees:
 *
 *   - physical-law checks keep their runtime label and stay one row each;
 *   - structural checks fold into ONE summary row ("场景结构 12/12 项有效"),
 *     expanding only when something in it failed;
 *   - any check id that still lacks a label gets a readable Chinese fallback
 *     instead of the raw identifier.
 *
 * Nothing here changes the snapshot data the Agent reads — this is presentation
 * over `VerificationCheckView[]`, so `findCheck` lookups keep resolving.
 */

import type { DerivedQuantityView, VerificationCheckView } from './scene-visual-model.ts'

/**
 * Structural check ids produced by `validateScene` (physics-scene). The
 * `prefix:targetId` form (`particle_units_known:particle-1`) is matched on the
 * prefix. `scene-structure` is the pre-folded row some runtimes already emit.
 */
const STRUCTURAL_CHECK_LABELS: Readonly<Record<string, string>> = {
  'scene-structure': '场景结构有效',
  scene_schema_version: '场景版本',
  scene_revision_valid: '场景修订号',
  scene_object_ids_unique: '对象标识唯一',
  observable_ids_unique: '可观察量标识唯一',
  observable_target_exists: '可观察量目标存在',
  coordinate_axes_valid: '坐标系正交',
  timeline_playback_rate_valid: '时间线播放率',
  timeline_dimensions_valid: '时间线量纲',
  particle_units_known: '粒子单位',
  particle_dimensions_valid: '粒子量纲',
  particle_mass_positive: '粒子质量为正',
  particle_position_finite: '粒子位置有限',
  body_units_known: '物体单位',
  body_dimensions_valid: '物体量纲',
  body_mass_positive: '物体质量为正',
  field_dimensions_valid: '场量纲',
  field_region_exists: '场区存在',
  circuit_component_dimensions: '元件量纲',
  circuit_component_values: '元件取值',
  circuit_connection_endpoints: '连线端点',
  circuit_node_ids_unique: '结点标识唯一',
  optical_element_dimensions: '光学元件量纲',
  optical_element_values: '光学元件取值',
  optical_object_dimensions: '光学物体量纲',
  optical_object_values: '光学物体取值',
  optical_screen_valid: '光屏有效',
  acoustic_bench_dimensions: '声学装置量纲',
  acoustic_bench_values: '声学装置取值',
  fluid_tank_dimensions: '水箱量纲',
  fluid_tank_values: '水箱取值',
  thermal_bench_dimensions: '热学装置量纲',
  thermal_bench_values: '热学装置取值',
  lever_bench_dimensions: '杠杆装置量纲',
  lever_bench_values: '杠杆装置取值',
  induction_bench_dimensions: '感应装置量纲',
  induction_bench_values: '感应装置取值',
  wave_bench_dimensions: '波动装置量纲',
  wave_bench_values: '波动装置取值',
  mechanics_scene_single_body: '单体力学场景',
  mechanics_model_supported: '力学模型可用',
}

/** The check id without its `:targetId` suffix. */
const baseIdOf = (id: string): string => {
  const colon = id.indexOf(':')
  return colon < 0 ? id : id.slice(0, colon)
}

export const isStructuralCheck = (id: string): boolean =>
  Object.prototype.hasOwnProperty.call(STRUCTURAL_CHECK_LABELS, baseIdOf(id))

/**
 * Readable fallback for a check whose runtime gave it no label: the structural
 * map first, then the identifier with its underscores opened up, so a student
 * never meets `plate_hit_time_consistent` verbatim.
 */
export const humanizeCheckId = (id: string): string => {
  const base = baseIdOf(id)
  const structural = STRUCTURAL_CHECK_LABELS[base]
  if (structural !== undefined) return structural
  return base.replace(/_/g, ' ')
}

/** True when the runtime left the raw identifier as the label. */
const labelIsRawId = (check: VerificationCheckView): boolean =>
  check.label === check.id || check.label === baseIdOf(check.id)

export interface PresentedVerification {
  /** Physical-law checks, one row each, labelled for a student. */
  readonly laws: readonly VerificationCheckView[]
  /** Structural preconditions folded into a count; `failed` lists the offenders. */
  readonly structure: {
    readonly passed: number
    readonly total: number
    readonly failed: readonly VerificationCheckView[]
  }
}

export const presentVerification = (
  checks: readonly VerificationCheckView[],
): PresentedVerification => {
  const laws: VerificationCheckView[] = []
  const failed: VerificationCheckView[] = []
  let passed = 0
  let total = 0
  for (const check of checks) {
    if (isStructuralCheck(check.id)) {
      /* A pre-folded "场景结构有效" row carries its own N/N in `detail`. */
      const folded = check.id === 'scene-structure' ? /^(\d+)\s*\/\s*(\d+)$/.exec(check.detail ?? '') : null
      if (folded !== null) {
        passed += Number(folded[1])
        total += Number(folded[2])
      } else {
        total += 1
        if (check.status === 'passed') passed += 1
      }
      if (check.status !== 'passed') {
        failed.push(labelIsRawId(check) ? { ...check, label: humanizeCheckId(check.id) } : check)
      }
      continue
    }
    laws.push(labelIsRawId(check) ? { ...check, label: humanizeCheckId(check.id) } : check)
  }
  return { laws, structure: { passed, total, failed } }
}

/* ------------------------------------------------------------ derived rows -- */

/**
 * A derived row whose value the runtime formatted as a vector: `(x, y)` or
 * `(x, y, z)` — the electric runtimes publish both a vector and a magnitude
 * under the SAME label (电场强度 twice), which reads as a duplicate.
 */
const VECTOR_VALUE = /^\(\s*[^,()]+\s*,\s*[^,()]+(?:\s*,\s*[^,()]+)?\s*\)$/

export interface PresentedDerived extends DerivedQuantityView {
  /** Vector components shown under the magnitude when both were published. */
  readonly components?: string
}

/**
 * Fold a vector row and a magnitude row that share a label into one row: the
 * magnitude is the headline number, the components sit beneath it. Rows that
 * are alone keep their form. Order follows the first appearance of each label.
 */
export const presentDerived = (rows: readonly DerivedQuantityView[]): readonly PresentedDerived[] => {
  const out: PresentedDerived[] = []
  const indexByLabel = new Map<string, number>()
  for (const row of rows) {
    const isVector = VECTOR_VALUE.test(row.value.trim())
    const existing = indexByLabel.get(row.label)
    if (existing === undefined) {
      indexByLabel.set(row.label, out.length)
      out.push(row)
      continue
    }
    const prior = out[existing]
    if (prior === undefined) continue
    const priorIsVector = VECTOR_VALUE.test(prior.value.trim())
    if (priorIsVector && !isVector) {
      /* Magnitude arrives after the vector: promote it, demote the vector. */
      const highlights = prior.highlights ?? row.highlights
      out[existing] = {
        ...row,
        components: prior.value,
        ...(highlights === undefined ? {} : { highlights }),
      }
    } else if (!priorIsVector && isVector) {
      out[existing] = { ...prior, components: row.value }
    } else {
      /* Two scalars (or two vectors) with one label: keep both, the runtime
         meant them as distinct facts (e.g. 加速度 as vector then as |a|). */
      out.push(row)
    }
  }
  return out
}

/**
 * `3.51e+14` → `3.51 × 10¹⁴`, `-1.60e-19` → `−1.60 × 10⁻¹⁹`; anything that is
 * not exponent notation is returned unchanged. Textbook notation, not the
 * calculator's — the number is the same, only its typesetting changes.
 */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '',
}

export const typesetNumber = (text: string): string =>
  text.replace(/(-?\d+(?:\.\d+)?)e([+-]?\d+)/g, (_, mantissa: string, exponent: string) => {
    const exp = exponent.replace(/^\+/, '').split('').map(ch => SUPERSCRIPT[ch] ?? ch).join('')
    const sign = mantissa.startsWith('-') ? '−' : ''
    return `${sign}${mantissa.replace(/^-/, '')} × 10${exp}`
  }).replace(/^-(\d)/, '−$1')
