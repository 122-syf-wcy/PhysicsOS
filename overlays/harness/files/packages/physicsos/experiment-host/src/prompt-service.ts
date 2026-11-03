/** Versioned prompt drafts and publication, over the existing durable storage boundary. */
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ExperimentError, type IdentityActor } from './identity.ts'
import {
  developerPromptDomain,
  promptStateSchema,
  promptVersionSchema,
  type PromptState,
  type PromptVersionRecord,
} from './prompt-domain.ts'
import {
  importPromptMarkdown,
  validateBody,
  validPromptBinding,
  PROMPT_IMPORT_LIMIT,
  type PromptDocument,
  type PromptSeed,
} from './prompt-format.ts'

const revisionWire = z
  .object({ expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
  .strict()
const saveWire = revisionWire
  .extend({ version: promptVersionSchema, body: z.string(), note: z.string().max(500) })
  .strict()
const importWire = revisionWire
  .extend({
    version: promptVersionSchema,
    filename: z.string().min(1).max(180),
    base64: z.string().max(Math.ceil(PROMPT_IMPORT_LIMIT / 3) * 4),
    note: z.string().max(500),
  })
  .strict()
const activateWire = revisionWire
  .extend({
    id: z.string().regex(/^prompt_[a-f0-9]{32}$/),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const contentHash = (value: Pick<PromptDocument, 'version' | 'body' | 'binding'>): string =>
  hash({ version: value.version, body: value.body, binding: value.binding })
const requireAdmin = (actor: IdentityActor): void => {
  if (actor.role !== 'SUPER_ADMIN')
    throw new ExperimentError(403, 'FORBIDDEN', '仅平台管理员可管理开发提示词。')
}
const invalid = (message = '提示词字段无效，请检查版本、正文和修改说明。'): ExperimentError =>
  new ExperimentError(400, 'INVALID_PROMPT', message)
const project = (record: PromptVersionRecord): PromptDocument =>
  structuredClone({
    id: record.id,
    version: record.version,
    body: record.body,
    sha256: record.sha256,
    binding: record.binding,
    publishedAt: record.publishedAt,
  })
export interface PromptAdminView {
  revision: number
  current: PromptDocument
  draft: PromptState['draft']
  versions: PromptVersionRecord[]
  seed: PromptSeed
  bindingChanged: boolean
}

export class DeveloperPromptService {
  private state: PromptState = {
    revision: 0,
    draft: null,
    versions: [],
    activeId: null,
    releases: [],
  }
  private tail: Promise<void> = Promise.resolve()
  private fenced = false
  private readonly seed: PromptSeed
  constructor(
    private readonly domain: Domain<typeof developerPromptDomain>,
    seed: PromptSeed,
  ) {
    if (!validPromptBinding(seed.binding)) throw invalid('系统提示词绑定无效。')
    this.seed = structuredClone({ body: validateBody(seed.body), binding: seed.binding })
  }
  async initialize(): Promise<void> {
    await this.tail
    const saved = this.domain.table('state').get('convex-lens')
    if (!saved) return
    const next = promptStateSchema.parse(saved)
    const ids = new Set<string>(),
      versions = new Set<string>()
    for (const item of next.versions) {
      if (ids.has(item.id) || versions.has(item.version) || contentHash(item) !== item.sha256)
        throw new Error('Invalid persisted prompt history')
      ids.add(item.id)
      versions.add(item.version)
    }
    if (
      (next.activeId !== null && !ids.has(next.activeId)) ||
      (next.versions.length > 0 && next.activeId === null) ||
      (next.draft !== null && versions.has(next.draft.version)) ||
      next.releases.some(item => !ids.has(item.id) || item.revision > next.revision)
    )
      throw new Error('Invalid persisted prompt references')
    this.state = structuredClone(next)
  }
  async close(): Promise<void> {
    await this.tail
  }
  private assertReadable(): void {
    if (this.fenced)
      throw new ExperimentError(503, 'STATE_UNCERTAIN', '提示词存储状态需要恢复，请稍后重试。')
  }
  current(): PromptDocument {
    this.assertReadable()
    const active = this.state.versions.find(item => item.id === this.state.activeId)
    if (active) return project(active)
    const document = {
      id: 'system-default',
      version: '1.0.0',
      ...structuredClone(this.seed),
      publishedAt: null,
    }
    return { ...document, sha256: contentHash(document) }
  }
  published(id: string): PromptDocument {
    this.assertReadable()
    const item = this.state.versions.find(version => version.id === id)
    if (!item) throw new ExperimentError(404, 'NOT_FOUND', '未找到已发布的提示词版本。')
    return project(item)
  }
  admin(actor: IdentityActor): PromptAdminView {
    requireAdmin(actor)
    return structuredClone({
      revision: this.state.revision,
      current: this.current(),
      draft: this.state.draft,
      versions: this.state.versions,
      seed: this.seed,
      bindingChanged:
        this.state.draft !== null &&
        this.state.draft.bindingFingerprint !== hash(this.seed.binding),
    })
  }
  private async mutate(
    actor: IdentityActor,
    expectedRevision: number,
    change: (state: PromptState) => void,
  ): Promise<PromptAdminView> {
    requireAdmin(actor)
    const operation = this.tail.then(async () => {
      this.assertReadable()
      if (this.state.revision !== expectedRevision)
        throw new ExperimentError(
          409,
          'REVISION_CONFLICT',
          '其他管理员已更新提示词；你的文字仍保留，请刷新服务器版本后再保存。',
        )
      const next = structuredClone(this.state)
      next.revision += 1
      change(next)
      promptStateSchema.parse(next)
      try {
        await this.domain.table('state').put('convex-lens', next)
      } catch (error) {
        // A write can reject after committing. Restore the previous durable row;
        // refuse further reads/writes if its outcome cannot be established.
        this.fenced = true
        try {
          await this.domain.table('state').put('convex-lens', structuredClone(this.state))
          this.fenced = false
        } catch {
          /* Remain fenced until the service and storage are reopened. */
        }
        throw error
      }
      this.state = next
      return this.admin(actor)
    })
    this.tail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
  async save(actor: IdentityActor, input: unknown): Promise<PromptAdminView> {
    requireAdmin(actor)
    const result = saveWire.safeParse(input)
    if (!result.success) throw invalid()
    const value = result.data
    let body: string
    try {
      body = validateBody(value.body)
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : undefined)
    }
    return this.mutate(actor, value.expectedRevision, (state) => {
      if (state.versions.some(item => item.version === value.version))
        throw new ExperimentError(409, 'VERSION_EXISTS', '该提示词版本已发布，请设置新的版本号。')
      state.draft = {
        version: value.version,
        body,
        note: value.note.trim(),
        bindingFingerprint: hash(this.seed.binding),
        updatedBy: actor.userKey,
        updatedAt: new Date().toISOString(),
      }
    })
  }
  async import(actor: IdentityActor, input: unknown): Promise<PromptAdminView> {
    requireAdmin(actor)
    const result = importWire.safeParse(input)
    if (!result.success) throw invalid('Markdown 文件超过 128 KiB 或字段无效。')
    const value = result.data
    if (
      !/\.(md|markdown)$/i.test(value.filename) ||
      /[/\\\u0000-\u001f\u007f]/.test(value.filename) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)
    )
      throw invalid('请选择 UTF-8 编码的 .md 或 .markdown 文件。')
    const bytes = Buffer.from(value.base64, 'base64')
    if (bytes.length > PROMPT_IMPORT_LIMIT) throw invalid('Markdown 文件不能超过 128 KiB。')
    let body: string
    try {
      body = importPromptMarkdown(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw invalid('Markdown 编码、大小、正文或平台导出标记无效。')
    }
    return this.save(actor, {
      expectedRevision: value.expectedRevision,
      version: value.version,
      note: value.note,
      body,
    })
  }
  async publish(actor: IdentityActor, input: unknown): Promise<PromptAdminView> {
    requireAdmin(actor)
    const result = revisionWire.safeParse(input)
    if (!result.success) throw invalid()
    return this.mutate(actor, result.data.expectedRevision, (state) => {
      const draft = state.draft
      if (!draft) throw new ExperimentError(409, 'NO_DRAFT', '请先保存提示词草稿。')
      if (draft.bindingFingerprint !== hash(this.seed.binding))
        throw new ExperimentError(
          409,
          'BINDING_CHANGED',
          '系统规范或模板已更新，请重新保存并核对完整预览后发布。',
        )
      if (state.versions.length >= 200 || state.releases.length >= 1000)
        throw new ExperimentError(
          409,
          'HISTORY_LIMIT',
          '提示词历史已达到保存上限，请联系平台维护者。',
        )
      const document = {
        id: `prompt_${randomBytes(16).toString('hex')}`,
        version: draft.version,
        body: draft.body,
        binding: structuredClone(this.seed.binding),
        publishedAt: new Date().toISOString(),
        publishedBy: actor.userKey,
        note: draft.note,
      }
      const item = { ...document, sha256: contentHash(document) }
      state.versions.push(item)
      state.activeId = item.id
      state.draft = null
      state.releases.push({
        action: 'publish',
        id: item.id,
        actorKey: actor.userKey,
        createdAt: item.publishedAt,
        revision: state.revision,
      })
    })
  }
  async activate(actor: IdentityActor, input: unknown): Promise<PromptAdminView> {
    requireAdmin(actor)
    const result = activateWire.safeParse(input)
    if (!result.success) throw invalid()
    return this.mutate(actor, result.data.expectedRevision, (state) => {
      const item = state.versions.find(version => version.id === result.data.id)
      if (!item) throw new ExperimentError(404, 'NOT_FOUND', '未找到已发布的提示词版本。')
      if (item.sha256 !== result.data.expectedSha256)
        throw new ExperimentError(409, 'CONTENT_CHANGED', '版本摘要不一致，请刷新后重试。')
      if (state.releases.length >= 1000)
        throw new ExperimentError(
          409,
          'HISTORY_LIMIT',
          '提示词历史已达到保存上限，请联系平台维护者。',
        )
      state.activeId = item.id
      state.releases.push({
        action: 'activate',
        id: item.id,
        actorKey: actor.userKey,
        createdAt: new Date().toISOString(),
        revision: state.revision,
      })
    })
  }
}
