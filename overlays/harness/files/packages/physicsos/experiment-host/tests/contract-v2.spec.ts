import { describe, expect, it } from 'vitest'
import { manifestV2Schema, validatePackageMetadata } from '../src/contract-v2.ts'
import { evaluateCase } from '../src/contract-optics.ts'
import { isExperimentIntent, isSnapshot } from '../src/contract-wire.ts'
import { files, manifest, caseDocument, parameterDocument, licenseDocument } from './fixtures.ts'
const metadata = (name?: string, value?: unknown) =>
  new Map(
    Object.entries(files()).map(([file, data]) => [
      file,
      Buffer.from(file === name ? JSON.stringify(value) : data),
    ]),
  )
function replaceAt(
  value: unknown,
  path: readonly (string | number)[],
  replacement: unknown,
): unknown {
  const [key, ...rest] = path
  if (key === undefined) return replacement
  if (Array.isArray(value) && typeof key === 'number') {
    const next: unknown[] = value.slice()
    next[key] = replaceAt(next[key], rest, replacement)
    return next
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof key === 'string'
  ) {
    const record = value as Record<string, unknown>
    return { ...record, [key]: replaceAt(record[key], rest, replacement) }
  }
  throw new Error('Invalid fixture edit path')
}
const edited = (file: string, path: readonly (string | number)[], replacement: unknown) => {
  const value: unknown = JSON.parse(files()[file as keyof ReturnType<typeof files>])
  return metadata(file, replaceAt(value, path, replacement))
}

describe('V2 canonical package contract', () => {
  it('accepts complete metadata and engine-evaluated cases', () => {
    expect(manifestV2Schema.safeParse(manifest).success).toBe(true)
    expect(validatePackageMetadata(metadata(), evaluateCase)).toEqual([])
    expect(evaluateCase({ objectDistanceCm: 30, focalLengthCm: 10, objectHeightCm: 4 })).toEqual({
      imageDistanceCm: 15,
      imageHeightCm: -2,
      imageKind: 'real',
    })
    const virtual = evaluateCase({ objectDistanceCm: 5, focalLengthCm: 10, objectHeightCm: 4 })
    expect(virtual.imageDistanceCm).toBeCloseTo(-10, 10)
    expect(virtual.imageHeightCm).toBeCloseTo(8, 10)
    expect(virtual.imageKind).toBe('virtual')
  })
  it.each(['01.2.3', '1.02.3', '1.2.03', '1.0.0-beta', '1.2.3+local', `${'1'.repeat(29)}.0.0`])(
    'rejects unstable or oversized version %s',
    (version) => {
      expect(manifestV2Schema.safeParse({ ...manifest, version }).success).toBe(false)
    },
  )
  it.each([
    { experimentId: 'unsupported' },
    { protocolVersion: 1 },
    { engine: { id: 'optics', contractVersion: 2 } },
  ])('rejects incompatible manifest %j', (change) => {
    expect(manifestV2Schema.safeParse({ ...manifest, ...change }).success).toBe(false)
  })
  it.each([
    ['parameters.json', ['parameters', 0, 'unit'], 'm'],
    [
      'parameters.json',
      ['parameters'],
      [
        ...parameterDocument.parameters,
        { ...parameterDocument.parameters[0], id: 'objectHeightCm' },
      ],
    ],
    ['parameters.json', ['parameters', 0, 'safety', 'max'], 201],
    ['teaching.json', ['title'], '   '],
    ['teaching.json', ['steps'], ['\t']],
    ['teaching.json', ['extra'], 'secret-sensitive-value'],
    ['cases.json', ['cases'], caseDocument.cases.filter(c => c.id !== 'at-f')],
    ['cases.json', ['cases'], [...caseDocument.cases, caseDocument.cases[0]]],
    ['cases.json', ['cases', 0, 'input', 'objectDistanceCm'], 31],
    ['cases.json', ['cases', 0, 'expected', 'imageHeightCm'], 2],
    [
      'cases.json',
      ['cases'],
      [
        ...caseDocument.cases,
        {
          id: 'near-f',
          input: { objectDistanceCm: 10 + 1e-10, focalLengthCm: 10, objectHeightCm: 4 },
          expected: { imageDistanceCm: 1e12, imageHeightCm: -1e12, imageKind: 'real' },
        },
      ],
    ],
    ['ASSET-LICENSES.json', [0, 'path'], 'dist/missing.png'],
    ['ASSET-LICENSES.json', [0, 'notice'], 'missing.txt'],
    ['ASSET-LICENSES.json', [0, 'notice'], '../LICENSE'],
    ['ASSET-LICENSES.json', [0, 'path'], 'dist/**'],
    ['ASSET-LICENSES.json', [0, 'source'], 'http://example.com'],
    ['ASSET-LICENSES.json', [], licenseDocument.slice(1)],
  ] as const)('rejects altered or incomplete %s', (file, path, replacement) => {
    const issues = validatePackageMetadata(edited(file, path, replacement), evaluateCase)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]?.file).toBe(file)
    expect(JSON.stringify(issues)).not.toContain('secret-sensitive-value')
  })
  it('bounds malformed JSON, oversized documents and diagnostic fields', () => {
    const bad = metadata()
    bad.set('teaching.json', Buffer.from('{secret-sensitive-value'))
    expect(validatePackageMetadata(bad, evaluateCase)).toMatchObject([
      { file: 'teaching.json', path: '$' },
    ])
    bad.set('cases.json', Buffer.alloc(256 * 1024 + 1))
    const issues = validatePackageMetadata(bad, evaluateCase)
    expect(issues.length).toBeLessThanOrEqual(20)
    for (const issue of issues) {
      expect(issue.message.length).toBeLessThanOrEqual(200)
      expect(issue.path.length).toBeLessThanOrEqual(240)
    }
    expect(JSON.stringify(issues)).not.toContain('secret-sensitive-value')
  })
  it('uses absolute plus relative tolerance while evaluating every extra case', () => {
    const accepted = structuredClone(caseDocument)
    accepted.cases[0]!.expected.imageDistanceCm! += 1e-8
    accepted.cases.push({
      id: 'extra',
      input: { objectDistanceCm: 40, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: 40 / 3, imageHeightCm: -4 / 3, imageKind: 'real' },
    })
    expect(validatePackageMetadata(metadata('cases.json', accepted), evaluateCase)).toEqual([])
    accepted.cases.at(-1)!.expected.imageDistanceCm! += 0.001
    expect(validatePackageMetadata(metadata('cases.json', accepted), evaluateCase)).not.toEqual([])
  })
  it('accepts only the three safety-bounded parameter intents', () => {
    for (const id of ['objectDistanceCm', 'focalLengthCm', 'screenDistanceCm']) {
      for (const value of [1, 200])
        expect(isExperimentIntent({ type: 'parameter/commit', id, value })).toBe(true)
      for (const value of [0, 201, Infinity])
        expect(isExperimentIntent({ type: 'parameter/preview', id, value })).toBe(false)
    }
    expect(isExperimentIntent({ type: 'parameter/commit', id: 'objectHeightCm', value: 4 })).toBe(
      false,
    )
    expect(isExperimentIntent({ type: 'parameter/cancel' })).toBe(true)
    expect(isExperimentIntent({ type: 'parameter/cancel', command: 'extra' })).toBe(false)
  })
  it('refuses fixture snapshots unless a local SDK explicitly opts in', () => {
    const frame = {
      revision: 1,
      source: 'platform-engine',
      parameters: {
        objectDistanceCm: 30,
        focalLengthCm: 10,
        objectHeightCm: 4,
        screenDistanceCm: 15,
      },
      visible: { image: true, rays: true },
      rays: [],
      result: { imageDistanceCm: 15, imageHeightCm: -2, imageKind: 'real', screenSharp: true },
    }
    expect(isSnapshot(frame)).toBe(true)
    expect(isSnapshot({ ...frame, source: 'preview-fixture' })).toBe(false)
    expect(isSnapshot({ ...frame, source: 'preview-fixture' }, { allowFixture: true })).toBe(true)
    expect(isSnapshot({ ...frame, parameters: { ...frame.parameters, objectHeightCm: 201 } })).toBe(
      false,
    )
  })
})
