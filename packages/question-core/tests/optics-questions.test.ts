import { describe, expect, it } from 'vitest'

import type { QuestionDocument } from '../src/question-document.ts'
import {
  DeterministicOpticsQuestionParser,
  isOpticsQuestionText,
  processQuestion,
} from '../src/index.ts'

/* Build a QuestionDocument inline so the test does not depend on
   golden-questions.ts (another agent owns that file). */
const inlineDoc = (text: string): QuestionDocument => ({
  id: 'q-optics-inline' as QuestionDocument['id'],
  content: { source: 'text', rawText: text, extractedText: text, status: 'EXTRACTED' },
  metadata: { title: '光学测试题', tags: ['optics'], difficulty: 'standard' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const scalar = (result: ReturnType<typeof processQuestion>, key: string): number => {
  const derived = result.simulation?.derivedQuantities.find((candidate) => candidate.key === key)
  if (derived === undefined || 'vector' in derived.value) {
    throw new Error(`Missing scalar derived quantity ${key}`)
  }
  return derived.value.value
}

describe('DeterministicOpticsQuestionParser', () => {
  it('detects convex lens text as an optics question', () => {
    expect(isOpticsQuestionText('凸透镜焦距 10 cm，物距 30 cm，求像距与放大率。')).toBe(true)
  })

  it('does not claim an electric-field question', () => {
    expect(isOpticsQuestionText('匀强电场中电荷量为 1 C 的粒子，E = 2 N/C。')).toBe(false)
  })

  it('extracts focal length, object distance and targets for a convex lens', () => {
    const doc = inlineDoc('凸透镜焦距 10 cm，物距 30 cm，求像距与放大率。')
    const candidate = DeterministicOpticsQuestionParser.parse(doc)

    expect(candidate.confidence).toBeGreaterThan(0.8)
    expect(candidate.ir.domain).toBe('optics')
    expect(candidate.ir.model).toBe('thin_lens_imaging')
    expect(candidate.ir.entities).toEqual(expect.arrayContaining(['lens', 'optical_object']))
    expect(candidate.ir.relations).toContain('thin_lens_imaging')
    expect(candidate.ir.assumptions).toContain('thin_lens_imaging')
    expect(candidate.ir.assumptions).toContain('paraxial_approximation')
    expect(candidate.ir.targets).toEqual(
      expect.arrayContaining(['image_distance', 'magnification']),
    )
    expect(candidate.ir.knowns.find((k) => k.key === 'focal_length')?.value).toBeCloseTo(0.1)
    expect(candidate.ir.knowns.find((k) => k.key === 'object_distance')?.value).toBeCloseTo(0.3)
  })

  it('detects a plane mirror question', () => {
    const doc = inlineDoc('平面镜前放一支蜡烛，物距为 15 cm，求像距与放大率。')
    const candidate = DeterministicOpticsQuestionParser.parse(doc)

    expect(candidate.ir.domain).toBe('optics')
    expect(candidate.ir.model).toBe('plane_mirror_imaging')
    expect(candidate.ir.relations).toContain('plane_mirror_imaging')
    expect(candidate.ir.knowns.find((k) => k.key === 'object_distance')?.value).toBeCloseTo(0.15)
    expect(candidate.ir.targets).toEqual(
      expect.arrayContaining(['image_distance', 'magnification']),
    )
  })

  it('detects a concave mirror question', () => {
    const doc = inlineDoc('凹面镜焦距为 10 cm，物体放在镜前 30 cm 处，求像距。')
    const candidate = DeterministicOpticsQuestionParser.parse(doc)

    expect(candidate.ir.domain).toBe('optics')
    expect(candidate.ir.model).toBe('curved_mirror_imaging')
    expect(candidate.ir.relations).toContain('curved_mirror_imaging')
    expect(candidate.ir.knowns.find((k) => k.key === 'focal_length')?.value).toBeCloseTo(0.1)
    expect(candidate.ir.knowns.find((k) => k.key === 'object_distance')?.value).toBeCloseTo(0.3)
    expect(candidate.ir.targets).toContain('image_distance')
  })

  it('marks a diverging concave lens with a negative focal length', () => {
    const doc = inlineDoc('凹透镜焦距为 -10 cm，物距为 15 cm，求像距。')
    const candidate = DeterministicOpticsQuestionParser.parse(doc)

    expect(candidate.ir.model).toBe('thin_lens_imaging')
    const f = candidate.ir.knowns.find((k) => k.key === 'focal_length')
    expect(f?.value).toBeLessThan(0)
  })
})

describe('Optics Question full pipeline', () => {
  it('runs a convex lens question through Scene, Engine, Verifier and Observation', () => {
    const doc = inlineDoc('凸透镜焦距 10 cm，物距 30 cm，求像距与放大率。')
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.domain).toBe('optics')
    expect(result.ir?.model).toBe('thin_lens_imaging')

    /* The scene must contain exactly one optical bench with a thin lens. */
    expect(result.scene?.opticalBenches?.length).toBe(1)
    const bench = result.scene?.opticalBenches?.[0]
    expect(bench?.elements[0]?.type).toBe('thin_lens')

    /* The OpticsEngine runs and verification passes (thin_lens_equation +
       principal_rays_converge are built into the engine). */
    expect(result.simulation?.metadata.engineId).toBe('engine-optics')
    expect(result.simulation?.verification.status).toBe('passed')
    expect(result.simulation?.sceneId).toBe(result.scene?.id)
    expect(result.simulation?.sceneRevision).toBe(result.scene?.revision)

    /* Thin lens equation: 1/u + 1/v = 1/f
       u = 30 cm, f = 10 cm → v = 30*10/(30-10) = 15 cm
       m = v/u = 15/30 = 0.5 */
    expect(scalar(result, 'image_distance')).toBeCloseTo(15, 1)
    expect(scalar(result, 'magnification')).toBeCloseTo(0.5, 2)

    /* The derived quantities must include the expected keys. */
    expect(result.simulation?.derivedQuantities.some((d) => d.key === 'image_distance')).toBe(true)
    expect(result.simulation?.derivedQuantities.some((d) => d.key === 'magnification')).toBe(true)
    expect(result.simulation?.derivedQuantities.some((d) => d.key === 'object_distance')).toBe(true)
    expect(result.simulation?.derivedQuantities.some((d) => d.key === 'focal_length')).toBe(true)

    /* Observations must contain an optics image observation. */
    expect(result.observations).toBeDefined()
    const imageObs = result.observations?.observations.find((o) => o.type === 'optics_image')
    expect(imageObs).toBeDefined()

    /* The solution must surface the image distance and magnification. */
    expect(result.solution?.results['image_distance']).toBeDefined()
    expect(result.solution?.results['magnification']).toBeDefined()
  })

  it('runs a plane mirror question through the full pipeline', () => {
    const doc = inlineDoc('平面镜前放一支蜡烛，物距为 15 cm，求像距与放大率。')
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('READY')
    expect(result.validation?.status).toBe('VALID')
    expect(result.ir?.model).toBe('plane_mirror_imaging')
    expect(result.simulation?.metadata.engineId).toBe('engine-optics')
    expect(result.simulation?.verification.status).toBe('passed')

    /* Plane mirror: v = u = 15 cm, m = 1. */
    expect(scalar(result, 'image_distance')).toBeCloseTo(15, 1)
    expect(scalar(result, 'magnification')).toBeCloseTo(1, 6)

    /* Verification must include the mirror symmetry check. */
    const symmetryCheck = result.simulation?.verification.checks.find(
      (check) => check.id === 'mirror_image_symmetry',
    )
    expect(symmetryCheck?.passed).toBe(true)
  })

  it('answers 像的性质 by quoting the engine imaging verdict (convex mirror: 正立缩小虚像)', () => {
    const doc = inlineDoc('凸面镜焦距 f = -10 cm，物体距镜面 u = 20 cm。求：像的性质')
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.targets).toContain('image_nature')
    expect(result.solution?.results['image_nature']?.value).toBe('正立、缩小、虚像')
    /* No other target was asked for, so nothing else is answered. */
    expect(Object.keys(result.solution?.results ?? {})).toEqual(['image_nature'])
    const step = result.solution?.steps.find((candidate) => candidate.title === '判断像的性质')
    expect(step?.resultValue).toBe('正立、缩小、虚像')
  })

  it('answers 倒正 and 像高 for a converging lens beyond 2f (倒立缩小实像)', () => {
    const doc = inlineDoc(
      '凸透镜焦距 f = 10 cm，物高 4 cm，物距 u = 30 cm。求：像高、像是倒立还是正立、像的虚实',
    )
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('READY')
    expect(result.ir?.targets).toEqual(
      expect.arrayContaining(['image_height', 'image_orientation', 'image_nature']),
    )
    expect(result.solution?.results['image_orientation']?.value).toBe('倒立')
    expect(result.solution?.results['image_nature']?.value).toBe('倒立、缩小、实像')
    /* h' = m·h = 0.5 × 4 cm = 2 cm */
    expect(Number(result.solution?.results['image_height']?.value)).toBeCloseTo(2, 6)
  })
})

describe('Optics semantic validation', () => {
  it('returns INVALID_SEMANTICS when focal length is missing for a lens', () => {
    const doc = inlineDoc('凸透镜前放一物体，物距 30 cm，求像距。')
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_FOCAL_LENGTH' }),
    )
    expect(result.scene).toBeNull()
  })

  it('returns INVALID_SEMANTICS when object distance is missing', () => {
    const doc = inlineDoc('凸透镜焦距 10 cm，求像距。')
    const result = processQuestion(doc)

    expect(result.workflowState).toBe('INVALID_SEMANTICS')
    expect(result.validation?.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_OBJECT_DISTANCE' }),
    )
  })
})
