/** Registered browser renderers only. Physics facts always come from the platform runtime. */
import { z } from 'zod'
import registry from './experiment-registry.json' with { type: 'json' }
import { assetLicensesV2Schema, schemaContractIssues, type ContractIssue } from './contract-v2.ts'
import { safeArchivePath } from './package-resources.ts'

export interface ExperimentProfile {
  id: string
  label: string
  domain: string
  parameters: {
    id: string
    label: string
    unit: string
    min?: number
    max?: number
    step?: number
    value: number
  }[]
  choices: {
    id: string
    label: string
    value: string
    options: { value: string; label: string }[]
  }[]
}
export const experimentCatalog: readonly ExperimentProfile[] = registry
export const experimentProfile = (id: unknown): ExperimentProfile | undefined =>
  typeof id === 'string' ? experimentCatalog.find((profile) => profile.id === id) : undefined
const nonblank = (max: number) => z.string().trim().min(1).max(max)
export const manifestV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    protocolVersion: z.literal(3),
    packageType: z.literal('browser-static'),
    experimentId: z.string().refine((id) => experimentProfile(id) !== undefined),
    version: z
      .string()
      .max(32)
      .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
    entry: z.literal('dist/index.html'),
    renderer: z.enum(['platform', 'three', 'canvas']),
    theme: z.literal('physicsos-warm-lab-v1'),
    engine: z.object({ id: z.string(), contractVersion: z.literal(1) }).strict(),
    parameters: z.literal('parameters.json'),
    teaching: z.literal('teaching.json'),
    referenceCases: z.literal('cases.json'),
    assetLicenses: z.literal('ASSET-LICENSES.json'),
    cover: z
      .string()
      .max(240)
      .refine((path) => safeArchivePath(path) && path.startsWith('dist/')),
    license: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/),
  })
  .strict()
  .refine((manifest) => experimentProfile(manifest.experimentId)?.domain === manifest.engine.id, {
    path: ['engine', 'id'],
  })
const parameter = z
  .object({
    id: nonblank(100),
    label: nonblank(120),
    unit: z.string().max(80),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    value: z.number().finite(),
  })
  .strict()
const choice = z
  .object({
    id: nonblank(100),
    label: nonblank(120),
    value: nonblank(100),
    options: z
      .array(z.object({ value: nonblank(100), label: nonblank(120) }).strict())
      .min(1)
      .max(100),
  })
  .strict()
const readOnlySnapshot = ['domain', 'title', 'view', 'inspector', 'clock'] as const
const sameParameter = (
  actual: z.infer<typeof parameter>,
  canonical: ExperimentProfile['parameters'][number],
): boolean =>
  (['id', 'label', 'unit', 'min', 'max', 'step', 'value'] as const).every(
    (key) => actual[key] === canonical[key],
  )
const sameChoice = (
  actual: z.infer<typeof choice>,
  canonical: ExperimentProfile['choices'][number],
): boolean =>
  actual.id === canonical.id &&
  actual.label === canonical.label &&
  actual.value === canonical.value &&
  actual.options.length === canonical.options.length &&
  actual.options.every(
    (option, index) =>
      option.value === canonical.options[index]?.value &&
      option.label === canonical.options[index]?.label,
  )
export function parametersV3Schema(profile: ExperimentProfile) {
  return z
    .object({
      schemaVersion: z.literal(3),
      experimentId: z.literal(profile.id),
      parameters: z
        .array(parameter)
        .max(100)
        .refine(
          (rows) =>
            rows.length === profile.parameters.length &&
            rows.every((row, index) => sameParameter(row, profile.parameters[index]!)),
        ),
      choices: z
        .array(choice)
        .max(100)
        .refine(
          (rows) =>
            rows.length === profile.choices.length &&
            rows.every((row, index) => sameChoice(row, profile.choices[index]!)),
        ),
      readOnlySnapshot: z.tuple([
        z.literal(readOnlySnapshot[0]),
        z.literal(readOnlySnapshot[1]),
        z.literal(readOnlySnapshot[2]),
        z.literal(readOnlySnapshot[3]),
        z.literal(readOnlySnapshot[4]),
      ]),
    })
    .strict()
}
const validInput = (
  profile: ExperimentProfile,
  input: { parameters: Record<string, number>; choices: Record<string, string> },
): boolean =>
  Object.entries(input.parameters).every(([id, value]) => {
    const canonical = profile.parameters.find((parameter) => parameter.id === id)
    return (
      canonical !== undefined &&
      Number.isFinite(value) &&
      (canonical.min === undefined || value >= canonical.min) &&
      (canonical.max === undefined || value <= canonical.max)
    )
  }) &&
  Object.entries(input.choices).every(([id, value]) =>
    profile.choices
      .find((choice) => choice.id === id)
      ?.options.some((option) => option.value === value),
  )
export function validatePackageMetadataV3(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: z.infer<typeof manifestV3Schema>,
): ContractIssue[] {
  const profile = experimentProfile(manifest.experimentId)!
  const issues: ContractIssue[] = []
  const add = (file: string, path: string, message: string): void => {
    if (issues.length < 20)
      issues.push({
        code: 'INVALID_METADATA',
        file,
        path,
        message,
        suggestion: '对照所选实验的 V3 模板恢复元数据与资源声明。',
      })
  }
  const decode = <T>(file: string, schema: z.ZodType<T>): T | undefined => {
    const bytes = files.get(file)
    if (!bytes || bytes.byteLength > 256 * 1024) {
      add(file, '$', '文件缺失或超过 256 KiB。')
      return
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      add(file, '$', '文件不是有效 UTF-8 JSON。')
      return
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      issues.push(
        ...schemaContractIssues(file, parsed.error)
          .slice(0, 20 - issues.length)
          .map((issue) => ({
            ...issue,
            suggestion: '对照所选实验的 V3 模板恢复字段、参数 ID 与数值范围。',
          })),
      )
      return
    }
    return parsed.data
  }
  decode('parameters.json', parametersV3Schema(profile))
  decode(
    'teaching.json',
    z
      .object({
        schemaVersion: z.literal(3),
        experimentId: z.literal(profile.id),
        title: nonblank(120),
        steps: z.array(nonblank(500)).min(1).max(12),
        limitations: z.array(nonblank(500)).min(1).max(12),
      })
      .strict(),
  )
  const cases = decode(
    'cases.json',
    z
      .object({
        schemaVersion: z.literal(3),
        experimentId: z.literal(profile.id),
        source: z.literal('platform-engine'),
        cases: z
          .array(
            z
              .object({
                id: z
                  .string()
                  .max(64)
                  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
                input: z
                  .object({
                    parameters: z.record(z.string(), z.number().finite()),
                    choices: z.record(z.string(), z.string()),
                  })
                  .strict()
                  .refine((input) => validInput(profile, input)),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
  )
  if (cases && new Set(cases.cases.map((item) => item.id)).size !== cases.cases.length)
    add('cases.json', '$.cases', '参考案例 ID 重复。')
  const licenses = decode('ASSET-LICENSES.json', assetLicensesV2Schema)
  if (licenses) {
    const names = [...files.keys()]
    const matches = (path: string, name: string): boolean =>
      path.endsWith('/*') ? name.startsWith(path.slice(0, -1)) : path === name
    for (const [index, license] of licenses.entries()) {
      if (!names.some((name) => matches(license.path, name)))
        add('ASSET-LICENSES.json', `$[${index}].path`, '许可条目未匹配实际文件。')
      if (license.notice !== undefined && !files.has(license.notice))
        add('ASSET-LICENSES.json', `$[${index}].notice`, '许可通知文件不存在。')
    }
    for (const name of names)
      if (
        (name === manifest.cover ||
          name.startsWith('dist/assets/') ||
          name.startsWith('dist/vendor/')) &&
        !licenses.some((license) => matches(license.path, name))
      )
        add('ASSET-LICENSES.json', '$', '封面、assets 或 vendor 资源缺少许可覆盖。')
  }
  return issues
}
