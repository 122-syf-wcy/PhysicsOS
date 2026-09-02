import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  PhysicsSemanticIR,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticRelation,
  SemanticTarget,
  WaveModelId,
} from './semantic-ir.ts'

/**
 * Deterministic mechanical-wave question parser (机械波).
 *
 * Three textbook rigs share the parser: a travelling wave on a rope (v = λf,
 * T = 1/f), two coherent sources judged at an observation point by the path
 * difference Δ = |r₂ − r₁|, and a string clamped at both ends resonating in its
 * n-th harmonic (L = nλ/2, f_n = n·v/2L). The parser extracts A, λ, f (or T),
 * v, d, r₁ / r₂ (or Δ), L and n, records the sub-model, and emits a
 * `PhysicsSemanticIR { domain: 'wave' }`. It computes nothing — a question
 * that states v and f gets both recorded, and the scene layer resolves λ.
 *
 * It must NOT claim optics interference (光的干涉 / 双缝), electromagnetic
 * waves or the acoustics echo rig, none of which the wave engine models.
 */

/**
 * Wave signal: a mechanical-wave keyword. 波长 / 波速 alone would also fire on
 * optics and sound questions, so the exclusion list below is checked first.
 */
const WAVE_SIGNAL =
  /机械波|横波|纵波|绳波|水波|简谐波|波长|波速|驻波|波节|波腹|谐波|基频|相干波源|波源|波的叠加|波的干涉|干涉/

/** Signals that hand the question to another parser (or to no parser). */
const NON_WAVE_SIGNAL = /光的干涉|双缝|薄膜|电磁波|光波|折射|透镜|回声|声速|洛伦兹|磁感应|电场强度/

export const isWaveQuestionText = (text: string): boolean =>
  WAVE_SIGNAL.test(text) && !NON_WAVE_SIGNAL.test(text)

function parseScientificNumber(text: string): number | null {
  const normalized = text.replace(/\s+/g, '')
  const scientific = /^([+-]?\d+(?:\.\d+)?)\s*[×x*]\s*10\^?([+-]?\d+)$/i.exec(normalized)
  if (scientific?.[1] !== undefined && scientific[2] !== undefined) {
    return Number(scientific[1]) * 10 ** Number(scientific[2])
  }
  const exponent = /^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(normalized)
  if (exponent?.[1] !== undefined && exponent[2] !== undefined) {
    return Number(exponent[1]) * 10 ** Number(exponent[2])
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

interface ExtractedValue {
  readonly siValue: number
  readonly originalUnit: string
}

function extractValueWithUnit(
  text: string,
  patterns: readonly RegExp[],
  defaultUnit: string,
): ExtractedValue | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1] === undefined) continue
    const value = parseScientificNumber(match[1])
    const unit = (match[2] ?? defaultUnit).trim()
    if (value === null || !isKnownUnit(unit)) continue
    try {
      return { siValue: canonicalValue(parseQuantity(value, unit)), originalUnit: unit }
    } catch {
      continue
    }
  }
  return null
}

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\^?[+-]?\d+|e[+-]?\d+)?`
const LENGTH_UNIT = String.raw`(?:cm|mm|m|dm|km)`
const SPEED_UNIT = String.raw`(?:m\/s|cm\/s|km\/h|km\/s)`
const FREQUENCY_UNIT = String.raw`(?:Hz|kHz)`
const TIME_UNIT = String.raw`(?:s|ms)`

const WAVE_PATTERNS = {
  amplitude: [
    new RegExp(String.raw`振幅(?:均|都)?(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`\bA\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`),
  ],
  wavelength: [
    new RegExp(String.raw`波长(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`λ\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
  ],
  frequency: [
    new RegExp(String.raw`频率(?:均|都)?(?:为|是|=)?\s*(${NUMBER})\s*(${FREQUENCY_UNIT})?\b`, 'i'),
    new RegExp(String.raw`\bf\s*=\s*(${NUMBER})\s*(${FREQUENCY_UNIT})?\b`),
    new RegExp(String.raw`以\s*(${NUMBER})\s*(${FREQUENCY_UNIT})\s*(?:的频率)?振动`, 'i'),
  ],
  period: [
    new RegExp(String.raw`周期(?:为|是|=)?\s*(${NUMBER})\s*(${TIME_UNIT})\b`, 'i'),
    new RegExp(String.raw`\bT\s*=\s*(${NUMBER})\s*(${TIME_UNIT})\b`),
  ],
  waveSpeed: [
    new RegExp(String.raw`波速(?:为|是|=)?\s*(${NUMBER})\s*(${SPEED_UNIT})?\b`, 'i'),
    new RegExp(String.raw`以\s*(${NUMBER})\s*(${SPEED_UNIT})\s*(?:的速度)?(?:沿|在|向).{0,8}传播`, 'i'),
    new RegExp(String.raw`传播速度(?:为|是|=)?\s*(${NUMBER})\s*(${SPEED_UNIT})?\b`, 'i'),
    new RegExp(String.raw`\bv\s*=\s*(${NUMBER})\s*(${SPEED_UNIT})?\b`),
  ],
  sourceSeparation: [
    new RegExp(String.raw`(?:两|双)?波源(?:之间)?(?:的)?(?:间距|距离|相距)(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`相距\s*(${NUMBER})\s*(${LENGTH_UNIT})\b`, 'i'),
    new RegExp(String.raw`\bd\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`),
  ],
  pathOne: [
    new RegExp(String.raw`到\s*S[₁1]\s*(?:的)?距离(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`r[₁1]\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
  ],
  pathTwo: [
    new RegExp(String.raw`到\s*S[₂2]\s*(?:的)?距离(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`r[₂2]\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
  ],
  pathDifference: [
    new RegExp(String.raw`(?:路程差|波程差)(?:Δ)?(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`Δ\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
  ],
  stringLength: [
    new RegExp(String.raw`(?:弦|绳)(?:的)?长(?:度)?(?:为|是|=)?\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`, 'i'),
    new RegExp(String.raw`长\s*(?:L\s*=\s*)?(${NUMBER})\s*(${LENGTH_UNIT})\s*的(?:弦|琴弦|绳)`, 'i'),
    new RegExp(String.raw`\bL\s*=\s*(${NUMBER})\s*(${LENGTH_UNIT})?\b`),
  ],
} as const

const CHINESE_NUMERALS: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/**
 * Harmonic number: 三次谐波 / 第 3 谐波 / n = 3 / 基频 (n = 1). Undefined when
 * the text names none — a standing question without it is not solvable.
 */
function extractHarmonic(text: string): number | undefined {
  const digits = /(?:第\s*)?(\d+)\s*次?\s*谐波/.exec(text) ?? /\bn\s*=\s*(\d+)\b/.exec(text)
  if (digits?.[1] !== undefined) return Number(digits[1])
  const words = /(?:第\s*)?([一二两三四五六七八九十])\s*次?\s*谐波/.exec(text)
  if (words?.[1] !== undefined) return CHINESE_NUMERALS[words[1]]
  if (/基频|基音|一次谐波/.test(text)) return 1
  return undefined
}

function known(
  key: string,
  label: string,
  symbol: string,
  value: number,
  unit: string,
  dimension: string,
): KnownValue {
  return { key, label, symbol, value, unit, dimension, displayValue: `${value} ${unit}` }
}

/**
 * Which wave rig the text describes. Standing-wave vocabulary (驻波 / 波节 /
 * 谐波 / 两端固定) wins over interference vocabulary because a standing wave
 * IS a superposition and questions often say so; interference vocabulary
 * (干涉 / 相干 / 路程差 / two sources) wins over the bare travelling wave.
 */
function detectSubModel(text: string): WaveModelId {
  if (/驻波|波节|波腹|谐波|基频|两端固定/.test(text)) return 'standing_wave'
  if (/干涉|相干|路程差|波程差|两个?波源|双波源|S[₁1].*S[₂2]|叠加/.test(text)) return 'wave_interference'
  return 'travelling_wave'
}

function detectTargets(text: string, model: WaveModelId): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  const add = (target: SemanticTarget): void => {
    if (!targets.includes(target)) targets.push(target)
  }
  /* Only the part after 求 / 判断 / 问 names what is asked; a stated 波长 in
     the givens must not read as a target. */
  const asked = text.split(/求[:：]?|判断|问[:：]?/).slice(1).join(' ')
  if (asked.length === 0) return targets
  if (/波速|传播速度|传播的速度/.test(asked)) add('wave_speed')
  if (/波长/.test(asked)) add('wavelength')
  if (/周期/.test(asked)) add('wave_period')
  if (/频率/.test(asked)) add('wave_frequency')
  if (model === 'wave_interference') {
    if (/加强|减弱|振动情况|如何振动|怎样振动|叠加/.test(asked)) add('interference_type')
    if (/合振幅|振幅/.test(asked)) add('resultant_amplitude')
    if (/路程差|波程差/.test(asked)) add('path_difference')
  }
  if (model === 'standing_wave' && /波节|波腹/.test(asked)) add('node_count')
  return targets
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } => {
  const values: Partial<Record<SemanticTarget, { label: string; symbol: string }>> = {
    wave_speed: { label: '波速', symbol: 'v' },
    wavelength: { label: '波长', symbol: 'λ' },
    wave_frequency: { label: '频率', symbol: 'f' },
    wave_period: { label: '周期', symbol: 'T' },
    path_difference: { label: '路程差', symbol: 'Δ' },
    interference_type: { label: '振动加强或减弱', symbol: '' },
    resultant_amplitude: { label: '合振幅', symbol: 'A_P' },
    node_count: { label: '波节个数', symbol: '' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

export const DeterministicWaveQuestionParser: QuestionParserProvider = {
  id: 'deterministic-wave-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const model = detectSubModel(text)

    const amplitude = extractValueWithUnit(text, WAVE_PATTERNS.amplitude, 'cm')
    if (amplitude !== null) {
      knowns.push(known('wave_amplitude', '振幅', 'A', amplitude.siValue, 'm', 'length'))
    }
    const wavelength = extractValueWithUnit(text, WAVE_PATTERNS.wavelength, 'm')
    if (wavelength !== null) {
      knowns.push(known('wavelength', '波长', 'λ', wavelength.siValue, 'm', 'length'))
    }
    const frequency = extractValueWithUnit(text, WAVE_PATTERNS.frequency, 'Hz')
    if (frequency !== null) {
      knowns.push(known('wave_frequency', '频率', 'f', frequency.siValue, 'Hz', 'frequency'))
    }
    const period = extractValueWithUnit(text, WAVE_PATTERNS.period, 's')
    if (period !== null) {
      knowns.push(known('wave_period', '周期', 'T', period.siValue, 's', 'time'))
    }
    const waveSpeed = extractValueWithUnit(text, WAVE_PATTERNS.waveSpeed, 'm/s')
    if (waveSpeed !== null) {
      knowns.push(known('wave_speed', '波速', 'v', waveSpeed.siValue, 'm/s', 'velocity'))
    }

    let sourceSeparation: ExtractedValue | null = null
    let pathOne: ExtractedValue | null = null
    let pathTwo: ExtractedValue | null = null
    let pathDifference: ExtractedValue | null = null
    if (model === 'wave_interference') {
      sourceSeparation = extractValueWithUnit(text, WAVE_PATTERNS.sourceSeparation, 'm')
      if (sourceSeparation !== null) {
        knowns.push(known('source_separation', '波源间距', 'd', sourceSeparation.siValue, 'm', 'length'))
      }
      pathOne = extractValueWithUnit(text, WAVE_PATTERNS.pathOne, 'm')
      pathTwo = extractValueWithUnit(text, WAVE_PATTERNS.pathTwo, 'm')
      if (pathOne !== null) knowns.push(known('path_one', '到 S₁ 的距离', 'r₁', pathOne.siValue, 'm', 'length'))
      if (pathTwo !== null) knowns.push(known('path_two', '到 S₂ 的距离', 'r₂', pathTwo.siValue, 'm', 'length'))
      pathDifference = extractValueWithUnit(text, WAVE_PATTERNS.pathDifference, 'm')
      if (pathDifference !== null && (pathOne === null || pathTwo === null)) {
        knowns.push(known('path_difference', '路程差', 'Δ', pathDifference.siValue, 'm', 'length'))
      }
    }

    let stringLength: ExtractedValue | null = null
    let harmonic: number | undefined
    if (model === 'standing_wave') {
      stringLength = extractValueWithUnit(text, WAVE_PATTERNS.stringLength, 'm')
      if (stringLength !== null) {
        knowns.push(known('string_length', '弦长', 'L', stringLength.siValue, 'm', 'length'))
      }
      harmonic = extractHarmonic(text)
      if (harmonic !== undefined) {
        knowns.push(known('harmonic', '谐波次数', 'n', harmonic, '', 'dimensionless'))
      }
    }

    const targets = detectTargets(text, model)

    const entities: PhysicsSemanticIR['entities'] =
      model === 'travelling_wave'
        ? ['rope', 'wave_source']
        : model === 'wave_interference'
          ? ['wave_source', 'wave_source', 'observation_point']
          : ['string']
    const relations: SemanticRelation[] =
      model === 'travelling_wave'
        ? ['wave_speed_relation']
        : model === 'wave_interference'
          ? ['wave_speed_relation', 'path_difference_superposition']
          : ['wave_speed_relation', 'standing_wave_resonance']
    const assumptions: SemanticAssumption[] =
      model === 'travelling_wave'
        ? ['ideal_medium_no_damping']
        : model === 'wave_interference'
          ? ['ideal_medium_no_damping', 'coherent_in_phase_sources']
          : ['ideal_medium_no_damping', 'string_clamped_both_ends']

    if (!isWaveQuestionText(text)) {
      issues.push({
        code: 'NOT_WAVE_QUESTION',
        message: '题目没有描述绳波、水波干涉或弦驻波这类机械波装置。',
        severity: 'error',
      })
    }
    const hasFrequency = frequency !== null || period !== null
    if (model !== 'standing_wave' && !hasFrequency) {
      issues.push({ code: 'MISSING_FREQUENCY', message: '缺少频率或周期。', severity: 'warning' })
    }
    if (model !== 'standing_wave' && wavelength === null && waveSpeed === null) {
      issues.push({ code: 'MISSING_WAVELENGTH_OR_SPEED', message: '缺少波长或波速。', severity: 'warning' })
    }
    if (model === 'wave_interference' && pathDifference === null && (pathOne === null || pathTwo === null)) {
      issues.push({ code: 'MISSING_PATH_DIFFERENCE', message: '缺少到两波源的距离或路程差。', severity: 'warning' })
    }
    if (model === 'standing_wave') {
      if (stringLength === null) {
        issues.push({ code: 'MISSING_STRING_LENGTH', message: '缺少弦长。', severity: 'warning' })
      }
      if (harmonic === undefined) {
        issues.push({ code: 'MISSING_HARMONIC', message: '缺少谐波次数。', severity: 'warning' })
      }
      if (waveSpeed === null && frequency === null) {
        issues.push({ code: 'MISSING_WAVE_SPEED', message: '缺少弦上波速或谐波频率。', severity: 'warning' })
      }
    }
    if (targets.length === 0) {
      issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
    }

    /* Structured fields carry only what the text stated; the period is folded
       into a frequency by the scene builder, never here. */
    const facts = {
      ...(amplitude === null ? {} : { waveAmplitude: amplitude.siValue }),
      ...(wavelength === null ? {} : { waveWavelength: wavelength.siValue }),
      ...(frequency === null ? {} : { waveFrequency: frequency.siValue }),
      ...(waveSpeed === null ? {} : { waveSpeed: waveSpeed.siValue }),
      ...(sourceSeparation === null ? {} : { waveSourceSeparation: sourceSeparation.siValue }),
      ...(pathOne === null ? {} : { wavePathOne: pathOne.siValue }),
      ...(pathTwo === null ? {} : { wavePathTwo: pathTwo.siValue }),
      ...(pathDifference === null ? {} : { wavePathDifference: pathDifference.siValue }),
      ...(stringLength === null ? {} : { waveStringLength: stringLength.siValue }),
      ...(harmonic === undefined ? {} : { waveHarmonic: harmonic }),
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'wave',
      model,
      entities,
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        {
          type: model,
          description:
            model === 'travelling_wave'
              ? '绳上的简谐横波：v = λf，T = 1/f，介质定波速、波源定频率'
              : model === 'wave_interference'
                ? '两个相干波源的叠加：Δ = nλ 加强，Δ = (n + ½)λ 减弱，A_P = |2A·cos(πΔ/λ)|'
                : '两端固定的弦驻波：L = nλ/2，f_n = n·v/(2L)，波节 n + 1 个',
        },
      ],
      relations,
      targets,
      assumptions,
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      ...facts,
    }

    const hasCoreKnowns =
      isWaveQuestionText(text) &&
      targets.length > 0 &&
      (model === 'standing_wave'
        ? stringLength !== null && harmonic !== undefined && (waveSpeed !== null || frequency !== null)
        : hasFrequency &&
          (wavelength !== null || waveSpeed !== null) &&
          (model !== 'wave_interference' || pathDifference !== null || (pathOne !== null && pathTwo !== null)))
    const confidence = hasCoreKnowns ? 0.9 : 0.3
    return { ir, issues, confidence }
  },
}
