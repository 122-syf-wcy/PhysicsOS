/**
 * Deterministic modern-physics parser.
 *
 * The photoelectric slice is fully modelled. Atomic-level, radioactive-decay and
 * nuclear-reaction questions are recognized only so validation can return
 * UNSUPPORTED_MODEL instead of handing them to a classical engine that would
 * fabricate an answer.
 */
import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  PhysicsSemanticIR,
  SemanticAssumption,
  SemanticEntity,
  SemanticRelation,
  SemanticTarget,
  UnsupportedModelId,
} from './semantic-ir.ts'

const PHOTOELECTRIC_SIGNAL = /光电效应|逸出功|功函数|遏止电压|截止频率|光电子|最大初动能/
const ATOMIC_SIGNAL = /氢原子|能级|跃迁|玻尔|光谱线/
const RADIOACTIVE_SIGNAL = /放射性|衰变|半衰期/
const NUCLEAR_SIGNAL = /核反应|质量亏损|结合能|裂变|聚变/

export const isModernPhysicsQuestionText = (text: string): boolean =>
  PHOTOELECTRIC_SIGNAL.test(text) ||
  ATOMIC_SIGNAL.test(text) ||
  RADIOACTIVE_SIGNAL.test(text) ||
  NUCLEAR_SIGNAL.test(text)

const unsupportedModelOf = (text: string): UnsupportedModelId | undefined => {
  if (ATOMIC_SIGNAL.test(text)) return 'atomic_energy_level'
  if (RADIOACTIVE_SIGNAL.test(text)) return 'radioactive_decay'
  if (NUCLEAR_SIGNAL.test(text)) return 'nuclear_reaction'
  return undefined
}

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\^?[+-]?\d+|e[+-]?\d+)?`

const numeric = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined
  const normalized = raw.replace(/\s+/g, '')
  const scientific = /^([+-]?\d+(?:\.\d+)?)[×x*]10\^?([+-]?\d+)$/i.exec(normalized)
  if (scientific?.[1] !== undefined && scientific[2] !== undefined) {
    return Number(scientific[1]) * 10 ** Number(scientific[2])
  }
  const exponent = /^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/i.exec(normalized)
  if (exponent?.[1] !== undefined && exponent[2] !== undefined) {
    return Number(exponent[1]) * 10 ** Number(exponent[2])
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

const known = (
  key: string,
  label: string,
  symbol: string,
  value: number,
  unit: string,
  dimension: string,
): KnownValue => ({ key, label, symbol, value, unit, dimension })

const targetRules: readonly { target: SemanticTarget; test: RegExp }[] = [
  { target: 'photon_energy', test: /光子能量|光子能量|光子的能量/ },
  { target: 'threshold_frequency', test: /截止频率|极限频率|红限频率/ },
  { target: 'threshold_wavelength', test: /截止波长|极限波长|红限波长/ },
  { target: 'max_kinetic_energy', test: /最大初动能|光电子的最大动能|光电子最大动能/ },
  { target: 'stopping_potential', test: /遏止电压|截止电压/ },
  { target: 'photocurrent', test: /光电流|饱和电流/ },
  { target: 'emits_photoelectrons', test: /能否发生光电效应|是否发生光电效应|是否逸出/ },
]

const targetsOf = (text: string): SemanticTarget[] => {
  const asked = text
    .split(/求[:：]?|判断|问[:：]?/)
    .slice(1)
    .join(' ')
  const scope = asked.length > 0 ? asked : text
  return [
    ...new Set(targetRules.filter((rule) => rule.test.test(scope)).map((rule) => rule.target)),
  ]
}

const entities: SemanticEntity[] = ['metal_cathode', 'photon', 'photoelectron']
const relations: SemanticRelation[] = ['photoelectric_effect']
const assumptions: SemanticAssumption[] = [
  'monochromatic_light',
  'one_photon_photoemission',
  'all_photoelectrons_collected',
]

export const DeterministicModernPhysicsQuestionParser: QuestionParserProvider = {
  id: 'deterministic-modern-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const unsupportedModel = unsupportedModelOf(text)
    const targets = unsupportedModel === undefined ? targetsOf(text) : []
    const knowns: KnownValue[] = []
    let workFunction: number | undefined
    let photonWavelength: number | undefined
    let lightIntensity: number | undefined
    let cathodeArea: number | undefined

    if (unsupportedModel === undefined) {
      const workFunctionMatch =
        new RegExp(String.raw`(?:逸出功|功函数|W)\s*=\s*(${NUMBER})\s*(eV|J)`, 'i').exec(text) ??
        new RegExp(String.raw`(?:逸出功|功函数)(?:为|是)?\s*(${NUMBER})\s*(eV|J)`, 'i').exec(text)
      const rawWorkFunction = numeric(workFunctionMatch?.[1])
      if (rawWorkFunction !== undefined) {
        const unit = workFunctionMatch?.[2] ?? 'J'
        workFunction =
          unit.toLowerCase() === 'ev' ? rawWorkFunction * 1.602176634e-19 : rawWorkFunction
        knowns.push(known('work_function', '逸出功', 'W', workFunction, 'J', 'energy'))
      }

      const wavelengthMatch =
        new RegExp(String.raw`(?:波长|λ)\s*=\s*(${NUMBER})\s*(nm|μm|um|mm|m)`, 'i').exec(text) ??
        new RegExp(String.raw`波长为\s*(${NUMBER})\s*(nm|μm|um|mm|m)`, 'i').exec(text)
      const rawWavelength = numeric(wavelengthMatch?.[1])
      if (rawWavelength !== undefined) {
        const unit = wavelengthMatch?.[2] ?? 'm'
        const factor =
          unit === 'nm' ? 1e-9 : unit === 'μm' || unit === 'um' ? 1e-6 : unit === 'mm' ? 1e-3 : 1
        photonWavelength = rawWavelength * factor
        knowns.push(known('photon_wavelength', '入射光波长', 'λ', photonWavelength, 'm', 'length'))
      }

      const intensityMatch =
        new RegExp(String.raw`(?:光强|强度|I)\s*=\s*(${NUMBER})\s*(W/m\^?2|W/m²)`, 'i').exec(
          text,
        ) ?? new RegExp(String.raw`光强(?:为|是)?\s*(${NUMBER})\s*(W/m\^?2|W/m²)`, 'i').exec(text)
      const rawIntensity = numeric(intensityMatch?.[1])
      if (rawIntensity !== undefined) {
        lightIntensity = rawIntensity
        knowns.push(known('light_intensity', '光强', 'I', lightIntensity, 'W/m^2', 'intensity'))
      }

      const areaMatch =
        new RegExp(
          String.raw`(?:阴极面积|面积|S)\s*=\s*(${NUMBER})\s*(cm\^?2|cm²|m\^?2|m²)`,
          'i',
        ).exec(text) ??
        new RegExp(String.raw`阴极面积(?:为|是)?\s*(${NUMBER})\s*(cm\^?2|cm²|m\^?2|m²)`, 'i').exec(
          text,
        )
      const rawArea = numeric(areaMatch?.[1])
      if (rawArea !== undefined) {
        const unit = areaMatch?.[2] ?? 'm^2'
        cathodeArea = unit.startsWith('cm') ? rawArea * 1e-4 : rawArea
        knowns.push(known('cathode_area', '阴极面积', 'S', cathodeArea, 'm^2', 'area'))
      }
    }

    const model = unsupportedModel ?? 'photoelectric_effect'
    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'modern_physics',
      model,
      entities,
      knowns,
      unknowns: targets.map((target) => ({ key: target, label: target, symbol: '' })),
      constraints: [
        {
          type: model,
          description:
            model === 'photoelectric_effect'
              ? '单光子光电效应：hf = W + Kmax，eUs = Kmax'
              : '已识别但尚未实现该现代物理模型',
        },
      ],
      relations: model === 'photoelectric_effect' ? relations : [],
      targets,
      assumptions: model === 'photoelectric_effect' ? assumptions : [],
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
      ...(workFunction === undefined ? {} : { workFunction }),
      ...(photonWavelength === undefined ? {} : { photonWavelength }),
      ...(lightIntensity === undefined ? {} : { lightIntensity }),
      ...(cathodeArea === undefined ? {} : { cathodeArea }),
    }
    return {
      ir,
      issues:
        unsupportedModel === undefined && targets.length === 0
          ? [
              {
                code: 'MISSING_TARGET',
                message: '未识别到需要求解的现代物理量。',
                severity: 'error',
              },
            ]
          : [],
      confidence: unsupportedModel === undefined ? (targets.length > 0 ? 0.95 : 0.3) : 0.9,
    }
  },
}
