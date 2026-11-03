import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rm, mkdtemp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { pickEngine, domainOfEngine } from '@physicsos/physics-runtime'
import type { CodeExperimentRef, CodeVisualizationSource } from '@physicsos/agent-tools'
import { z } from 'zod'
import { init, parse } from 'es-module-lexer'
import { ExperimentError, type PhysicsosIdentity, type IdentityActor } from './identity.ts'
import { ASSET_PREFIX, type Asset } from './service.ts'
import { experimentProfile, manifestV3Schema, validatePackageMetadataV3 } from './contract-v3.ts'
import { experimentTemplateFiles } from './template-download.ts'
import { safeArchivePath, validatePackageResources, assetContentType } from './package-resources.ts'
import {
  questionCodeDomain,
  questionCodeRecordSchema,
  type QuestionCodeRecord,
} from './question-code-domain.ts'
import { questionCodeContext, type QuestionCodeContext } from './question-code-context.ts'
import type { DeveloperPromptService } from './prompt-service.ts'
export const QUESTION_CODE_SERVICE = 'questionCodeArtifacts'
export interface QuestionCodeIdentity extends PhysicsosIdentity {
  sessionOwnerKey(sessionId: string): string | undefined
}
export interface CreateQuestionCodeInput {
  ownerSessionId: string
  scene: PhysicsScene
  experimentId: string
  childSessionId: string
  source: CodeVisualizationSource
}
export interface QuestionCodeArtifacts {
  create(input: CreateQuestionCodeInput): Promise<CodeExperimentRef>
  context(experimentId: string): Promise<QuestionCodeContext>
  describe(ownerSessionId: string, artifactId: string, expectedSha256: string): CodeExperimentRef
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    questionCodeArtifacts: QuestionCodeArtifacts
  }
}
export interface QuestionCodeOptions {
  root: string
  identity: () => QuestionCodeIdentity | undefined
  prompts?: Pick<DeveloperPromptService, 'current'>
  assetOrigin?: string
  previewTtlMs?: number
}
const executeFile = promisify(execFile)
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
/** Stable across object key ordering, while preserving every question field and array order. */
export function canonicalQuestionJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalQuestionJson).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) +
          ':' +
          canonicalQuestionJson((value as Record<string, unknown>)[key]),
      )
      .join(',') +
    '}'
  )
}
export const questionSceneSha256 = (scene: PhysicsScene): string =>
  hash(canonicalQuestionJson(scene))
const sourceSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().max(1000),
    rendererJs: z.string().min(1),
    stylesheet: z.string(),
  })
  .strict()
const inputSchema = z
  .object({
    ownerSessionId: z.string().min(1).max(200),
    childSessionId: z.string().min(1).max(200),
    experimentId: z.string().min(1).max(100),
    scene: z.unknown(),
    source: sourceSchema,
  })
  .strict()
const missing = (): ExperimentError =>
  new ExperimentError(404, 'NOT_FOUND', '未找到当前账号的题目实验。')
const invalidSource = (): ExperimentError =>
  new ExperimentError(400, 'INVALID_SOURCE', '生成代码未通过封闭资源、元数据或语法检查。')
const recordHash = (record: Omit<QuestionCodeRecord, 'sha256'> | QuestionCodeRecord): string => {
  const { sha256: ignored, ...body } = record as QuestionCodeRecord
  return hash(canonicalQuestionJson(body))
}
const project = (row: QuestionCodeRecord): CodeExperimentRef => ({
  status: 'ready',
  artifactId: row.id,
  ownerSessionId: row.ownerSessionId,
  childSessionId: row.childSessionId,
  sceneId: row.sceneId,
  sceneRevision: row.sceneRevision,
  sceneSha256: row.sceneSha256,
  experimentId: row.experimentId,
  sha256: row.sha256,
  title: row.title,
  createdAt: row.createdAt,
})
async function verifiedFile(
  path: string,
  expected: { sha256: string; size: number },
): Promise<Buffer> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== expected.size || stat.size > 20 * 1024 * 1024)
      throw new Error('invalid file')
    const bytes = await handle.readFile()
    if (hash(bytes) !== expected.sha256) throw new Error('digest mismatch')
    return bytes
  } catch {
    throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '冻结的题目实验文件校验失败。')
  } finally {
    await handle?.close()
  }
}
async function durableFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o400)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
interface Capability {
  id: string
  sha256: string
  expiresAt: number
  nonce: string
}
export class QuestionCodeArtifactService implements QuestionCodeArtifacts {
  private tail: Promise<void> = Promise.resolve()
  private initialized = false
  private secret: Buffer | undefined
  private readonly root: string
  readonly assetOrigin: string | undefined
  private readonly ttl: number
  constructor(
    private readonly domain: Domain<typeof questionCodeDomain>,
    private readonly options: QuestionCodeOptions,
  ) {
    this.root = resolve(options.root)
    this.ttl = Math.min(15 * 60_000, Math.max(1, options.previewTtlMs ?? 10 * 60_000))
    if (options.assetOrigin !== undefined) {
      const origin = new URL(options.assetOrigin)
      if (
        !['http:', 'https:'].includes(origin.protocol) ||
        origin.origin !== options.assetOrigin ||
        origin.username ||
        origin.password
      )
        throw new Error('Invalid asset origin')
      this.assetOrigin = origin.origin
    }
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await mkdir(join(this.root, 'blobs'), { recursive: true, mode: 0o700 })
    await mkdir(join(this.root, 'checks'), { recursive: true, mode: 0o700 })
    const keyPath = join(this.root, 'capability-key')
    try {
      await durableFile(keyPath, randomBytes(32))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const handle = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0)
        throw new Error('Invalid private capability key')
      this.secret = await handle.readFile()
    } finally {
      await handle.close()
    }
    for (const [id, row] of this.domain.table('artifacts').entries()) {
      this.checked(row)
      if (id !== row.id) throw new Error('Invalid artifact identity')
    }
    const rootDirectory = await open(this.root, 'r')
    try {
      await rootDirectory.sync()
    } finally {
      await rootDirectory.close()
    }
    this.initialized = true
  }
  async close(): Promise<void> {
    await this.tail
  }
  private requireReady(): void {
    if (!this.initialized || !this.secret)
      throw new ExperimentError(503, 'ARTIFACTS_UNAVAILABLE', '题目实验存储尚未就绪。')
  }
  private owner(sessionId: string): string | undefined {
    return this.options.identity()?.sessionOwnerKey(sessionId)
  }
  private checked(row: QuestionCodeRecord): QuestionCodeRecord {
    const parsed = questionCodeRecordSchema.parse(row)
    if (
      recordHash(parsed) !== parsed.sha256 ||
      !experimentProfile(parsed.experimentId) ||
      parsed.files.some((file) => !safeArchivePath(file.name)) ||
      new Set(parsed.files.map((file) => file.name)).size !== parsed.files.length
    )
      throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '题目实验身份校验失败。')
    return parsed
  }
  private record(id: string): QuestionCodeRecord {
    this.requireReady()
    if (!/^qcode_[a-f0-9]{32}$/.test(id)) throw missing()
    const row = this.domain.table('artifacts').get(id)
    if (!row) throw missing()
    return this.checked(row)
  }
  describe(ownerSessionId: string, artifactId: string, expectedSha256: string): CodeExperimentRef {
    const row = this.record(artifactId)
    if (row.ownerSessionId !== ownerSessionId || this.owner(ownerSessionId) !== row.ownerKey)
      throw missing()
    if (row.sha256 !== expectedSha256)
      throw new ExperimentError(409, 'ARTIFACT_REF_MISMATCH', '题目实验引用摘要不一致。')
    return project(row)
  }
  async context(experimentId: string): Promise<QuestionCodeContext> {
    return questionCodeContext(experimentId, this.options.prompts)
  }
  async create(input: CreateQuestionCodeInput): Promise<CodeExperimentRef> {
    const operation = this.tail.then(async () => {
      this.requireReady()
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw invalidSource()
      const ownerKey = this.owner(input.ownerSessionId)
      if (!ownerKey)
        throw new ExperimentError(
          403,
          'SESSION_OWNER_UNAVAILABLE',
          '对话必须已有可验证的账号归属。',
        )
      const scene = structuredClone(input.scene)
      try {
        if (validateScene(scene).status === 'failed') throw new Error('invalid scene')
      } catch {
        throw new ExperimentError(400, 'INVALID_SCENE', '题目物理场景未通过校验。')
      }
      const profile = experimentProfile(input.experimentId)
      const selected = pickEngine(scene)
      if (!profile || !selected.entry || profile.domain !== domainOfEngine(selected.entry.engine))
        throw new ExperimentError(400, 'SCENE_PROFILE_MISMATCH', '实验风格与题目物理领域不一致。')
      const source = parsed.data.source
      if (Buffer.byteLength(canonicalQuestionJson(source), 'utf8') > 128 * 1024)
        throw new ExperimentError(413, 'SOURCE_TOO_LARGE', '生成代码不能超过 128 KiB。')
      const context = await this.context(input.experimentId),
        files = experimentTemplateFiles(input.experimentId)
      files.set('src/renderer.js', Buffer.from(source.rendererJs))
      files.set('dist/runtime/renderer.js', Buffer.from(source.rendererJs))
      files.set('public/assets/experiment.css', Buffer.from(source.stylesheet))
      files.set('dist/assets/experiment.css', Buffer.from(source.stylesheet))
      try {
        const manifest = manifestV3Schema.parse(
          JSON.parse(files.get('experiment.json')!.toString('utf8')),
        )
        if (validatePackageMetadataV3(files, manifest).length) throw new Error('metadata')
        await validatePackageResources(files, manifest)
        await init
        if (!parse(source.rendererJs)[1].some((entry) => entry.n === 'renderFrame'))
          throw new Error('Missing renderFrame export')
        const checkDir = await mkdtemp(join(this.root, 'checks', 'renderer-'))
        try {
          const rendererPath = join(checkDir, 'renderer.mjs')
          await durableFile(rendererPath, Buffer.from(source.rendererJs))
          // Fixed executable and options, service-owned path, syntax only. Uploaded code is never run.
          await executeFile(process.execPath, ['--check', rendererPath], {
            timeout: 5000,
            maxBuffer: 4096,
            env: { PATH: process.env.PATH ?? '' },
          })
        } finally {
          await rm(checkDir, { recursive: true, force: true })
        }
      } catch {
        throw invalidSource()
      }
      files.set('question-scene.json', Buffer.from(canonicalQuestionJson(scene)))
      const frozen: QuestionCodeRecord['files'] = []
      for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        const digest = hash(bytes),
          path = join(this.root, 'blobs', digest)
        try {
          await durableFile(path, bytes)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          await verifiedFile(path, { sha256: digest, size: bytes.length })
        }
        frozen.push({
          name,
          sha256: digest,
          size: bytes.length,
          contentType: assetContentType(name) ?? 'application/octet-stream',
        })
      }
      const row: QuestionCodeRecord = {
        id: 'qcode_' + randomBytes(16).toString('hex'),
        ownerSessionId: input.ownerSessionId,
        ownerKey,
        childSessionId: input.childSessionId,
        sceneId: scene.id,
        sceneRevision: scene.revision,
        sceneSha256: questionSceneSha256(scene),
        experimentId: input.experimentId,
        sha256: '',
        title: source.title,
        summary: source.summary,
        createdAt: new Date().toISOString(),
        styleVersion: context.styleVersion,
        files: frozen,
      }
      row.sha256 = recordHash(row)
      this.checked(row)
      const blobsDirectory = await open(join(this.root, 'blobs'), 'r')
      try {
        await blobsDirectory.sync()
      } finally {
        await blobsDirectory.close()
      }
      // A deleted/reclaimed session during generation cannot acquire a completed artifact.
      if (this.owner(input.ownerSessionId) !== ownerKey) throw missing()
      await this.domain.table('artifacts').put(row.id, row)
      return project(row)
    })
    this.tail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
  private authorized(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): QuestionCodeRecord {
    const row = this.record(id)
    if (actor.userKey !== row.ownerKey || this.owner(row.ownerSessionId) !== actor.userKey)
      throw missing()
    if (expectedSha256 !== undefined && expectedSha256 !== row.sha256)
      throw new ExperimentError(409, 'ARTIFACT_REF_MISMATCH', '题目实验引用摘要不一致。')
    return row
  }
  preview(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): { entryUrl: string; expiresAt: number } {
    const row = this.authorized(actor, id, expectedSha256),
      expiresAt = Date.now() + this.ttl
    const body = Buffer.from(
      JSON.stringify({
        id: row.id,
        sha256: row.sha256,
        expiresAt,
        nonce: randomBytes(12).toString('hex'),
      } satisfies Capability),
    ).toString('base64url')
    const signature = createHmac('sha256', this.secret!)
      .update('physicsos-question-code-v1:' + body)
      .digest('base64url')
    const path = `${ASSET_PREFIX}/embed/question/${body}.${signature}/dist/index.html`
    return { entryUrl: this.assetOrigin ? new URL(path, this.assetOrigin).href : path, expiresAt }
  }
  async source(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): Promise<{ ref: CodeExperimentRef; source: CodeVisualizationSource }> {
    const row = this.authorized(actor, id, expectedSha256)
    const read = async (name: string): Promise<string> => {
      const file = row.files.find((entry) => entry.name === name)
      if (!file) throw missing()
      return (await verifiedFile(join(this.root, 'blobs', file.sha256), file)).toString('utf8')
    }
    const [rendererJs, stylesheet] = await Promise.all([
      read('src/renderer.js'),
      read('public/assets/experiment.css'),
    ])
    return {
      ref: project(row),
      source: { title: row.title, summary: row.summary, rendererJs, stylesheet },
    }
  }
  async asset(url: URL): Promise<Asset | undefined> {
    this.requireReady()
    const match =
      /^\/physicsos\/experiment-assets\/question\/([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})\/(.+)$/.exec(
        url.pathname,
      )
    if (
      !match?.[1] ||
      !match[2] ||
      !match[3] ||
      !safeArchivePath(match[3]) ||
      !match[3].startsWith('dist/')
    )
      return undefined
    const expected = createHmac('sha256', this.secret!)
        .update('physicsos-question-code-v1:' + match[1])
        .digest(),
      supplied = Buffer.from(match[2], 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return undefined
    let capability: Capability
    try {
      capability = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as Capability
    } catch {
      return undefined
    }
    if (
      !Number.isSafeInteger(capability.expiresAt) ||
      capability.expiresAt <= Date.now() ||
      capability.expiresAt > Date.now() + 15 * 60_000
    )
      return undefined
    let row: QuestionCodeRecord
    try {
      row = this.record(capability.id)
    } catch (error) {
      if (error instanceof ExperimentError && error.status === 404) return undefined
      throw error
    }
    if (capability.sha256 !== row.sha256 || this.owner(row.ownerSessionId) !== row.ownerKey)
      return undefined
    const file = row.files.find((item) => item.name === match[3])
    if (!file) return undefined
    return {
      protocolVersion: 3,
      bytes: await verifiedFile(join(this.root, 'blobs', file.sha256), file),
      contentType: file.contentType,
      scopePath: `${ASSET_PREFIX}/question/${match[1]}.${match[2]}/dist/`,
      immutable: false,
      sha256: file.sha256,
    }
  }
}
