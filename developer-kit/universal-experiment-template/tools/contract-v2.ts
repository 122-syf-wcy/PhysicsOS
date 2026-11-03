/** Portable authoring and server intake schemas. No submitted code is evaluated. */
import { z } from 'zod'
import { PARAMETER_CONTRACT } from './contract-wire.ts'

const nonblank = (max: number) => z.string().trim().min(1).max(max)
const safePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 240 &&
  /^[a-zA-Z0-9_./-]+$/.test(path) &&
  !path.startsWith('/') &&
  path.split('/').every(part => part !== '' && !part.startsWith('.'))
const packagePath = z.string().max(240).refine(safePath)
const distPath = packagePath.refine(path => path.startsWith('dist/'))
const licenseId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/)
/** The stable V2 manifest for the single registered convex-lens profile. */
export const manifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    protocolVersion: z.literal(2),
    packageType: z.literal('browser-static'),
    experimentId: z.literal('convex-lens'),
    version: z
      .string()
      .max(32)
      .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
    entry: z.literal('dist/index.html'),
    renderer: z.literal('three'),
    theme: z.literal('physicsos-warm-lab-v1'),
    engine: z.object({ id: z.literal('optics'), contractVersion: z.literal(1) }).strict(),
    parameters: z.literal('parameters.json'),
    teaching: z.literal('teaching.json'),
    referenceCases: z.literal('cases.json'),
    assetLicenses: z.literal('ASSET-LICENSES.json'),
    cover: distPath,
    license: licenseId,
  })
  .strict()
/** Example manifest; content versions remain author owned. */
export const manifestV2Example = {
  schemaVersion: 2,
  protocolVersion: 2,
  packageType: 'browser-static',
  experimentId: 'convex-lens',
  version: '1.0.0',
  entry: 'dist/index.html',
  renderer: 'three',
  theme: 'physicsos-warm-lab-v1',
  engine: { id: 'optics', contractVersion: 1 },
  parameters: 'parameters.json',
  teaching: 'teaching.json',
  referenceCases: 'cases.json',
  assetLicenses: 'ASSET-LICENSES.json',
  cover: 'dist/assets/cover.svg',
  license: 'Apache-2.0',
} as const
const readOnly = [
  'parameters.objectHeightCm',
  'visible.image',
  'visible.rays',
  'result',
  'rays',
] as const
/** Fixed writable IDs, units, ranges and read-only engine facts. */
export const parametersV2Document = {
  schemaVersion: 2,
  experimentId: 'convex-lens',
  parameters: PARAMETER_CONTRACT,
  readOnlySnapshot: readOnly,
} as const
const parameterSchema = (parameter: (typeof PARAMETER_CONTRACT)[number]) =>
  z
    .object({
      id: z.literal(parameter.id),
      label: z.literal(parameter.label),
      unit: z.literal('cm'),
      access: z.literal('read-write'),
      default: z.literal(parameter.default),
      safety: z.object({ min: z.literal(1), max: z.literal(200) }).strict(),
      display: z
        .object({
          min: z.literal(parameter.display.min),
          max: z.literal(parameter.display.max),
          step: z.literal(0.5),
        })
        .strict(),
    })
    .strict()
/** Exact generated parameter metadata, including ordering. */
export const parametersV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    experimentId: z.literal('convex-lens'),
    parameters: z.tuple([
      parameterSchema(PARAMETER_CONTRACT[0]),
      parameterSchema(PARAMETER_CONTRACT[1]),
      parameterSchema(PARAMETER_CONTRACT[2]),
    ]),
    readOnlySnapshot: z.tuple([
      z.literal(readOnly[0]),
      z.literal(readOnly[1]),
      z.literal(readOnly[2]),
      z.literal(readOnly[3]),
      z.literal(readOnly[4]),
    ]),
  })
  .strict()
/** Author-owned teaching content with bounded, nonblank text. */
export const teachingV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    experimentId: z.literal('convex-lens'),
    title: nonblank(120),
    steps: z.array(nonblank(500)).min(1).max(12),
    limitations: z.array(nonblank(500)).min(1).max(12),
  })
  .strict()
/** Starting teaching content for the template. */
export const teachingV2Example = {
  schemaVersion: 2,
  experimentId: 'convex-lens',
  title: '探究凸透镜成像规律',
  steps: ['改变物距，观察像距与像的方向。'],
  limitations: ['采用理想薄透镜近轴模型。'],
} as const
/** Case inputs use centimetres and the engine safety interval. */
export type CaseInput = { objectDistanceCm: number; focalLengthCm: number; objectHeightCm: number }
/** Image distances and heights are signed; no image uses exact null values. */
export type CaseExpected = {
  imageDistanceCm: number | null
  imageHeightCm: number | null
  imageKind: 'real' | 'virtual' | 'none'
}
/** Trusted optics supplied by the host or generated local tool. */
export type CaseEvaluator = (input: CaseInput) => CaseExpected
const finiteCm = z.number().min(1).max(200)
const caseInputSchema = z
  .object({ objectDistanceCm: finiteCm, focalLengthCm: finiteCm, objectHeightCm: finiteCm })
  .strict()
const expectedSchema = z
  .object({
    imageDistanceCm: z.number().nullable(),
    imageHeightCm: z.number().nullable(),
    imageKind: z.enum(['real', 'virtual', 'none']),
  })
  .strict()
/** Structured cases; required identities and engine results are checked semantically. */
export const casesV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    experimentId: z.literal('convex-lens'),
    unit: z.literal('cm'),
    cases: z
      .array(
        z
          .object({
            id: z
              .string()
              .max(64)
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            input: caseInputSchema,
            expected: expectedSchema,
          })
          .strict(),
      )
      .min(5)
      .max(50),
  })
  .strict()
/** Five required, hand-checked optical zones. */
export const casesV2Document = {
  schemaVersion: 2,
  experimentId: 'convex-lens',
  unit: 'cm',
  cases: [
    {
      id: 'beyond-2f',
      input: { objectDistanceCm: 30, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: 15, imageHeightCm: -2, imageKind: 'real' },
    },
    {
      id: 'at-2f',
      input: { objectDistanceCm: 20, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: 20, imageHeightCm: -4, imageKind: 'real' },
    },
    {
      id: 'between-f-2f',
      input: { objectDistanceCm: 15, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: 30, imageHeightCm: -8, imageKind: 'real' },
    },
    {
      id: 'at-f',
      input: { objectDistanceCm: 10, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: null, imageHeightCm: null, imageKind: 'none' },
    },
    {
      id: 'within-f',
      input: { objectDistanceCm: 5, focalLengthCm: 10, objectHeightCm: 4 },
      expected: { imageDistanceCm: -10, imageHeightCm: 8, imageKind: 'virtual' },
    },
  ],
} satisfies {
  schemaVersion: 2
  experimentId: 'convex-lens'
  unit: 'cm'
  cases: { id: string; input: CaseInput; expected: CaseExpected }[]
}
/** License declarations are structural evidence only, not a legal ownership claim. */
export const assetLicensesV2Schema = z
  .array(
    z
      .object({
        path: z
          .string()
          .max(240)
          .refine(
            path =>
              safePath(path.endsWith('/*') ? path.slice(0, -2) : path) && path.startsWith('dist/'),
          ),
        name: nonblank(120),
        license: licenseId,
        source: z
          .string()
          .min(1)
          .max(500)
          .refine((source) => {
            if (source === 'original') return true
            try {
              const url = new URL(source)
              return url.protocol === 'https:' && !url.username && !url.password
            } catch {
              return false
            }
          }),
        notice: packagePath.optional(),
      })
      .strict(),
  )
  .min(1)
  .max(1000)
/** License coverage for original assets and the template's Three.js resources. */
export const assetLicensesV2Example = [
  {
    path: 'dist/assets/*',
    name: 'Original assets',
    license: 'Apache-2.0',
    source: 'original',
    notice: 'LICENSE',
  },
  {
    path: 'dist/vendor/*',
    name: 'Three.js',
    license: 'MIT',
    source: 'https://github.com/mrdoob/three.js',
    notice: 'dist/vendor/THREE-LICENSE.txt',
  },
] as const
/** Safe, bounded diagnostics shared by REST and author tooling. */
export type ContractIssue = {
  code: string
  file: string
  path: string
  message: string
  suggestion: string
}
const fields = new Set([
  'schemaVersion',
  'protocolVersion',
  'experimentId',
  'version',
  'entry',
  'renderer',
  'theme',
  'engine',
  'id',
  'contractVersion',
  'parameters',
  'teaching',
  'referenceCases',
  'assetLicenses',
  'cover',
  'license',
  'packageType',
  'readOnlySnapshot',
  'label',
  'unit',
  'access',
  'default',
  'safety',
  'min',
  'max',
  'display',
  'step',
  'title',
  'steps',
  'limitations',
  'cases',
  'input',
  'expected',
  'objectDistanceCm',
  'focalLengthCm',
  'objectHeightCm',
  'imageDistanceCm',
  'imageHeightCm',
  'imageKind',
  'path',
  'name',
  'source',
  'notice',
])
const issuePath = (parts: readonly PropertyKey[]): string =>
  (
    '$' +
    parts
      .map(part =>
        typeof part === 'number' && Number.isSafeInteger(part) && part >= 0
          ? `[${part}]`
          : typeof part === 'string' && fields.has(part)
            ? `.${part}`
            : '.field',
      )
      .join('')
  ).slice(0, 240)
/** Sanitize schema diagnostics without exposing raw submitted values or unknown keys.
 * @param file Fixed contract filename.
 * @param error Failed schema validation.
 * @param code Stable error category.
 * @returns At most twenty fixed-message issues.
 */
export function schemaContractIssues(
  file: string,
  error: z.ZodError,
  code = 'INVALID_METADATA',
): ContractIssue[] {
  return error.issues
    .slice(0, 20)
    .map(issue => ({
      code,
      file,
      path: issuePath(issue.path),
      message: '字段缺失、类型错误或不符合实验契约。',
      suggestion: '对照 V2 模板恢复字段、单位与固定值。',
    }))
}
/** Adapter input is SI metres; returned case facts are signed centimetres.
 * @param input Bounded case input in centimetres.
 * @param thinLensOutcome Trusted platform optics function, never contributor code.
 * @returns The signed engine result in centimetres.
 */
export function evaluateCaseWithOptics(
  input: CaseInput,
  thinLensOutcome: (
    u: number,
    f: number,
    h: number,
    x: number,
  ) =>
    | { kind: 'no_image' }
    | {
      kind: 'image'
      image: {
        nature: 'real' | 'virtual'
        orientation: 'inverted' | 'upright'
        distance: number
        height: number
      }
    },
): CaseExpected {
  const result = thinLensOutcome(
    input.objectDistanceCm / 100,
    input.focalLengthCm / 100,
    input.objectHeightCm / 100,
    0,
  )
  if (result.kind === 'no_image')
    return { imageDistanceCm: null, imageHeightCm: null, imageKind: 'none' }
  return {
    imageDistanceCm: result.image.distance * 100 * (result.image.nature === 'virtual' ? -1 : 1),
    imageHeightCm:
      Math.abs(result.image.height) * 100 * (result.image.orientation === 'inverted' ? -1 : 1),
    imageKind: result.image.nature,
  }
}
const close = (a: number | null, b: number | null): boolean =>
  a === null || b === null
    ? a === b
    : Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-7 + 1e-9 * Math.max(Math.abs(a), Math.abs(b))
/** Decode the four fixed bounded documents, then check engine cases and file coverage.
 * @param files Safe package-relative files from archive or local release tooling.
 * @param evaluate Trusted engine case evaluator.
 * @returns At most twenty safe issues; an empty list permits these metadata files.
 */
export function validatePackageMetadata(
  files: ReadonlyMap<string, Uint8Array>,
  evaluate: CaseEvaluator,
): ContractIssue[] {
  const issues: ContractIssue[] = []
  const add = (file: string, path: string, message: string, suggestion: string): void => {
    if (issues.length < 20)
      issues.push({ code: 'INVALID_METADATA', file, path, message, suggestion })
  }
  const decode = <T>(file: string, schema: z.ZodType<T>): T | undefined => {
    const bytes = files.get(file)
    if (!bytes || bytes.byteLength > 256 * 1024) {
      add(file, '$', '文件缺失或超过 256 KiB。', '提供模板要求的有界 JSON 文件。')
      return
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      add(file, '$', '文件不是有效 UTF-8 JSON。', '修复 JSON 语法并使用 UTF-8 编码。')
      return
    }
    const result = schema.safeParse(value)
    if (!result.success) {
      issues.push(...schemaContractIssues(file, result.error).slice(0, 20 - issues.length))
      return
    }
    return result.data
  }
  decode('parameters.json', parametersV2Schema)
  decode('teaching.json', teachingV2Schema)
  const cases = decode('cases.json', casesV2Schema)
  const licenses = decode('ASSET-LICENSES.json', assetLicensesV2Schema)
  if (cases) {
    const seen = new Set<string>()
    for (const [index, item] of cases.cases.entries()) {
      const path = `$.cases[${index}]`
      if (seen.has(item.id))
        add('cases.json', `${path}.id`, '参考案例 ID 重复。', '为每个案例使用唯一 ID。')
      seen.add(item.id)
      const required = casesV2Document.cases.find(entry => entry.id === item.id)
      if (
        required &&
        (Object.keys(required.input) as (keyof CaseInput)[]).some(
          key => required.input[key] !== item.input[key],
        )
      )
        add(
          'cases.json',
          `${path}.input`,
          '必需案例的输入已改变。',
          '恢复模板中五个必需案例的输入。',
        )
      const expected = evaluate(item.input)
      if (
        expected.imageKind !== item.expected.imageKind ||
        !close(expected.imageDistanceCm, item.expected.imageDistanceCm) ||
        !close(expected.imageHeightCm, item.expected.imageHeightCm)
      )
        add(
          'cases.json',
          `${path}.expected`,
          '参考结果与平台光学引擎不一致。',
          '使用平台引擎结果，像距与像高保留正负方向。',
        )
    }
    for (const required of casesV2Document.cases)
      if (!seen.has(required.id))
        add('cases.json', '$.cases', '缺少必需的光学区域案例。', '保留模板中全部五个必需案例。')
  }
  if (licenses) {
    const names = [...files.keys()]
    const matches = (path: string, name: string): boolean =>
      path.endsWith('/*') ? name.startsWith(path.slice(0, -1)) : path === name
    for (const [index, license] of licenses.entries()) {
      if (!names.some(name => matches(license.path, name)))
        add(
          'ASSET-LICENSES.json',
          `$[${index}].path`,
          '许可条目未匹配实际文件。',
          '指向现有 dist 文件或目录下的 /*。',
        )
      if (license.notice !== undefined && !files.has(license.notice))
        add(
          'ASSET-LICENSES.json',
          `$[${index}].notice`,
          '许可通知文件不存在。',
          '加入该通知文件或修正安全的相对路径。',
        )
    }
    let cover: string | undefined
    const manifest = files.get('experiment.json')
    if (manifest && manifest.byteLength <= 256 * 1024) {
      try {
        const parsed = manifestV2Schema.safeParse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)),
        )
        if (parsed.success) cover = parsed.data.cover
      } catch {
        /* Manifest syntax is reported by the manifest consumer. */
      }
    }
    for (const name of names)
      if (
        (name === cover || name.startsWith('dist/assets/') || name.startsWith('dist/vendor/')) &&
        !licenses.some(license => matches(license.path, name))
      )
        add(
          'ASSET-LICENSES.json',
          '$',
          '封面、assets 或 vendor 资源缺少许可覆盖。',
          '为全部这些资源补充匹配的许可条目。',
        )
  }
  return issues
}
