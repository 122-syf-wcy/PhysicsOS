import { canonicalValue, isKnownUnit, parseQuantity } from '@physicsos/physics-units'

import type { QuestionDocument } from './question-document.ts'
import type { QuestionParseCandidate, QuestionParserProvider } from './question-parser.ts'
import type {
  KnownValue,
  OpticsModelId,
  PhysicsSemanticIR,
  QuestionParseIssue,
  SemanticAssumption,
  SemanticRelation,
  SemanticTarget,
} from './semantic-ir.ts'

/**
 * Optics-question signal keywords. A text must name an optical element (透镜/
 * 镜) and an imaging concern (焦距/物距/像距/放大率/成像/虚像/实像) to be
 * claimed as optics. The narrow element words (凸透镜/凹面镜/…) are the
 * discriminators; a bare 镜 with a distance is ambiguous and left to the
 * mechanics fallback.
 */
const OPTICS_SIGNAL = /凸透镜|凹透镜|平面镜|凹面镜|凸面镜|薄透镜|透镜|焦距|物距|像距|放大率|成像|虚像|实像|光屏|lens|mirror|focal\s+length|object\s+distance|image\s+distance|magnification/i

/** Signals that mark a question as NOT optics (electric/magnetic/circuit). */
const NON_OPTICS_SIGNAL = /匀强电场|电场强度|点电荷|洛伦兹力|匀强磁场|磁感应强度|电容器|平行板|电流|电压|电路|electric\s+field|magnetic\s+field/i

export const isOpticsQuestionText = (text: string): boolean =>
  OPTICS_SIGNAL.test(text) && !NON_OPTICS_SIGNAL.test(text)

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

const OPTICS_PATTERNS = {
  focalLength: [
    new RegExp(String.raw`焦距(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\bf\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  objectDistance: [
    new RegExp(String.raw`物距(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\bu\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`物体(?:放在|置于|位于|距|离)[^。；;，,\d]{0,8}?(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`物(?:放在|置于|位于)[^。；;，,\d]{0,6}?(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  imageDistance: [
    new RegExp(String.raw`像距(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`\bv\s*=\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  objectHeight: [
    new RegExp(String.raw`物高(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
    new RegExp(String.raw`物体高(?:度)?(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  imageHeight: [
    new RegExp(String.raw`像高(?:为|是|=)?\s*(${NUMBER})\s*(cm|mm|m)\b`, 'i'),
  ],
  magnification: [
    new RegExp(String.raw`放大率(?:为|是|=)?\s*(${NUMBER})\b`, 'i'),
    new RegExp(String.raw`放大倍数(?:为|是|=)?\s*(${NUMBER})\b`, 'i'),
    new RegExp(String.raw`\bm\s*=\s*(${NUMBER})\b`, 'i'),
  ],
} as const

/** Element-type detection from keywords. Returns the model id and element kind. */
function detectElementType(
  text: string,
): { model: OpticsModelId; element: 'thin_lens' | 'plane_mirror' | 'curved_mirror' } | null {
  if (/凸透镜|会聚透镜|convex\s+lens/i.test(text)) {
    return { model: 'thin_lens_imaging', element: 'thin_lens' }
  }
  if (/凹透镜|发散透镜|concave\s+lens/i.test(text)) {
    return { model: 'thin_lens_imaging', element: 'thin_lens' }
  }
  if (/平面镜|plane\s+mirror/i.test(text)) {
    return { model: 'plane_mirror_imaging', element: 'plane_mirror' }
  }
  if (/凹面镜|concave\s+mirror/i.test(text)) {
    return { model: 'curved_mirror_imaging', element: 'curved_mirror' }
  }
  if (/凸面镜|convex\s+mirror/i.test(text)) {
    return { model: 'curved_mirror_imaging', element: 'curved_mirror' }
  }
  /* A bare 透镜 / lens without a converging/diverging qualifier defaults to a
     thin lens (convex), the canonical junior-optics element. */
  if (/薄透镜|透镜|lens/i.test(text)) {
    return { model: 'thin_lens_imaging', element: 'thin_lens' }
  }
  /* A bare 镜 / mirror with imaging keywords — plane mirror is the default
     junior-optics mirror when no curvature is stated. */
  if (/镜|mirror/i.test(text)) {
    return { model: 'plane_mirror_imaging', element: 'plane_mirror' }
  }
  return null
}

/** Whether the text describes a diverging element (concave lens / convex mirror). */
function isDivergingElement(text: string): boolean {
  return /凹透镜|发散透镜|凸面镜|convex\s+mirror|concave\s+lens/i.test(text)
}

function detectTargets(text: string): SemanticTarget[] {
  const targets: SemanticTarget[] = []
  const add = (target: SemanticTarget): void => {
    if (!targets.includes(target)) targets.push(target)
  }
  if (/像距|image\s+distance|\bv\s*=/i.test(text)) add('image_distance')
  if (/像高|image\s+height/i.test(text)) add('image_height')
  if (/放大率|放大倍数|magnification|\bm\s*=/i.test(text)) add('magnification')
  if (/虚像|实像|像的?(?:虚|实)/i.test(text)) add('image_nature')
  if (/倒立|正立|倒正|像的?(?:倒|正)/i.test(text)) add('image_orientation')
  /* When the question asks for 成像 (imaging in general) without a specific
     target, surface the core imaging results. */
  if (/成像规律|成像特点|成像性质|成像情况|成像/i.test(text) && targets.length === 0) {
    add('image_distance')
    add('magnification')
    add('image_nature')
    add('image_orientation')
  }
  return targets
}

const targetMetadata = (target: SemanticTarget): { label: string; symbol: string } => {
  const values: Partial<Record<SemanticTarget, { label: string; symbol: string }>> = {
    image_distance: { label: '像距', symbol: 'v' },
    image_height: { label: '像高', symbol: "h'" },
    magnification: { label: '放大率', symbol: 'm' },
    image_nature: { label: '像的虚实', symbol: '' },
    image_orientation: { label: '像的倒正', symbol: '' },
    focal_length: { label: '焦距', symbol: 'f' },
    object_distance: { label: '物距', symbol: 'u' },
    object_height: { label: '物高', symbol: 'h' },
  }
  return values[target] ?? { label: target, symbol: '' }
}

function known(
  key: string,
  label: string,
  symbol: string,
  value: number,
  unit: string,
  dimension: string,
): KnownValue {
  return {
    key,
    label,
    symbol,
    value,
    unit,
    dimension,
    displayValue: `${value} ${unit}`,
  }
}

export const DeterministicOpticsQuestionParser: QuestionParserProvider = {
  id: 'deterministic-optics-v1',

  parse(document: QuestionDocument): QuestionParseCandidate {
    const text = document.content.extractedText || document.content.rawText || ''
    const issues: QuestionParseIssue[] = []
    const knowns: KnownValue[] = []

    const elementType = detectElementType(text)
    if (elementType === null) {
      issues.push({ code: 'NOT_OPTICS_QUESTION', message: '未识别到光学元件（透镜或镜）。', severity: 'error' })
      const ir: PhysicsSemanticIR = {
        schemaVersion: 'physics-ir/1.0',
        domain: 'optics',
        model: 'thin_lens_imaging',
        entities: ['lens', 'optical_object'],
        knowns: [],
        unknowns: [],
        constraints: [],
        relations: [],
        targets: [],
        assumptions: ['thin_lens_imaging', 'paraxial_approximation', 'geometric_optics'],
        chargeSign: 'unknown',
        fieldDirection: 'unknown',
        velocityDirection: 'unknown',
      }
      return { ir, issues, confidence: 0.1 }
    }

    const { model, element } = elementType
    const diverging = isDivergingElement(text)

    /* Extract known quantities (all stored as SI metres). */
    const focalLength = extractValueWithUnit(text, OPTICS_PATTERNS.focalLength, 'm')
    if (focalLength !== null) {
      /* Diverging elements have negative focal length; the scene builder and
         engine use the sign to choose the imaging law. */
      const signedF = diverging && element !== 'plane_mirror' ? -Math.abs(focalLength.siValue) : Math.abs(focalLength.siValue)
      knowns.push(known('focal_length', '焦距', 'f', signedF, 'm', 'length'))
    } else if (element !== 'plane_mirror') {
      issues.push({ code: 'MISSING_FOCAL_LENGTH', message: '缺少焦距。', severity: 'warning' })
    }

    const objectDistance = extractValueWithUnit(text, OPTICS_PATTERNS.objectDistance, 'm')
    if (objectDistance !== null) {
      knowns.push(known('object_distance', '物距', 'u', objectDistance.siValue, 'm', 'length'))
    } else {
      issues.push({ code: 'MISSING_OBJECT_DISTANCE', message: '缺少物距。', severity: 'warning' })
    }

    const objectHeight = extractValueWithUnit(text, OPTICS_PATTERNS.objectHeight, 'm')
    if (objectHeight !== null) {
      knowns.push(known('object_height', '物高', 'h', objectHeight.siValue, 'm', 'length'))
    }

    /* Detect targets from the question text. */
    const targets = detectTargets(text)

    /* Entity list depends on the element kind. */
    const entities: PhysicsSemanticIR['entities'] =
      element === 'thin_lens'
        ? ['lens', 'optical_object']
        : ['mirror', 'optical_object']
    if (/光屏|screen/i.test(text)) {
      entities.push('screen')
    }

    const relations: SemanticRelation[] = []
    const assumptions: SemanticAssumption[] = [model, 'paraxial_approximation', 'geometric_optics']
    if (element === 'thin_lens') {
      relations.push('thin_lens_imaging')
    } else if (element === 'plane_mirror') {
      relations.push('plane_mirror_imaging')
    } else {
      relations.push('curved_mirror_imaging')
    }

    if (targets.length === 0) {
      issues.push({ code: 'MISSING_TARGET', message: '未识别到需要求解的物理量。', severity: 'error' })
    }

    const ir: PhysicsSemanticIR = {
      schemaVersion: 'physics-ir/1.0',
      domain: 'optics',
      model,
      entities,
      knowns,
      unknowns: targets.map((target) => ({ key: target, ...targetMetadata(target) })),
      constraints: [
        {
          type: model,
          description:
            element === 'thin_lens'
              ? '薄透镜成像公式 1/u + 1/v = 1/f'
              : element === 'plane_mirror'
                ? '平面镜成像：像距等于物距，正立等大虚像'
                : '球面镜成像公式 1/u + 1/v = 1/f（f = R/2）',
        },
      ],
      relations,
      targets,
      assumptions,
      chargeSign: 'unknown',
      fieldDirection: 'unknown',
      velocityDirection: 'unknown',
    }

    const hasCoreKnowns =
      (element === 'plane_mirror' || focalLength !== null) &&
      objectDistance !== null &&
      targets.length > 0
    const confidence = hasCoreKnowns ? 0.9 : 0.3
    return { ir, issues, confidence }
  },
}
