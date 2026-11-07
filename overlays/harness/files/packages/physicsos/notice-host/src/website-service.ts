/** Public website projection and SUPER_ADMIN-only private management. */
import crypto from 'node:crypto'
import { z } from 'zod'
import { isImageAdmissionError, type AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { noticeDomain } from './domain.ts'
import { NoticeError, type IdentityActor } from './identity.ts'
import {
  websiteContentWire, websiteFeedbackWire, websiteReplyWire,
  type WebsiteContentRecord, type WebsiteFeedbackRecord,
} from './website-schema.ts'

const CONTENT_ID = 'website'
const IMAGE_BYTES = 5 * 1024 * 1024
const id = (prefix: string): string => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body)
  if (!result.success) throw new NoticeError(400, 'BAD_REQUEST', '官网数据格式或长度不符合要求')
  return result.data
}

/** Management reads require the same exact role as writes. */
export function requireWebsiteAdmin(actor: IdentityActor): void {
  if (actor.role !== 'SUPER_ADMIN') throw new NoticeError(403, 'FORBIDDEN', '仅平台超级管理员可管理官网')
}

const feedbackView = (row: WebsiteFeedbackRecord) => ({
  ...row,
  images: row.images.map(image => ({
    id: image.id,
    name: image.attachment.name ?? '截图',
    mediaType: image.attachment.mediaType,
    url: `/physicsos/notice/website-feedback/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}`,
  })),
})

export class WebsiteService {
  /** The deployment has one domain writer; serialize initial creation and optimistic saves together. */
  private contentTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly domain: Domain<typeof noticeDomain>,
    private readonly attachments: () => AttachmentStore | undefined,
  ) {}

  private currentContent(): WebsiteContentRecord {
    return this.domain.table('website_content').get(CONTENT_ID)
      ?? { version: 0, testimonials: [], contributors: [], updatedAt: '', updatedBy: '' }
  }

  getPublicContent() {
    const content = this.currentContent()
    return {
      testimonials: content.testimonials.filter(item => item.enabled).sort((a, b) => a.order - b.order)
        .map(({ id, name, role, quote, topic, color, order, enabled }) => ({ id, name, role, quote, topic, color, order, enabled })),
      contributors: content.contributors.filter(item => item.enabled).sort((a, b) => a.order - b.order)
        .map(({ id, name, role, project, description, url, avatar, color, order, enabled }) =>
          ({ id, name, role, project, description, url, avatar, color, order, enabled })),
    }
  }

  getContent(actor: IdentityActor): WebsiteContentRecord {
    requireWebsiteAdmin(actor)
    return this.currentContent()
  }

  updateContent(actor: IdentityActor, body: unknown): Promise<WebsiteContentRecord> {
    requireWebsiteAdmin(actor)
    const { expectedVersion, ...input } = parse(websiteContentWire, body)
    const result = this.contentTail.then(async () => {
      const current = this.currentContent()
      if (current.version !== expectedVersion) throw new NoticeError(409, 'VERSION_CONFLICT', '官网内容已被其他管理员更新，请刷新后重试')
      const next: WebsiteContentRecord = {
        ...input, version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor.userKey,
      }
      await this.domain.table('website_content').put(CONTENT_ID, next)
      return next
    })
    this.contentTail = result.then(() => {}, () => {})
    return result
  }

  async submitFeedback(body: unknown): Promise<{ id: string; createdAt: string }> {
    const { images = [], ...input } = parse(websiteFeedbackWire, body)
    const decoded = images.map(image => {
      const data = Buffer.from(image.data, 'base64')
      if (data.length === 0 || data.toString('base64') !== image.data) {
        throw new NoticeError(400, 'INVALID_IMAGE_BASE64', '截图必须是有效的纯 base64 图片')
      }
      if (data.length > IMAGE_BYTES) throw new NoticeError(413, 'IMAGE_TOO_LARGE', '单张截图不能超过 5 MiB')
      return { data, mediaType: image.mediaType, ...(image.name === undefined ? {} : { name: image.name }) }
    })
    let refs: Awaited<ReturnType<AttachmentStore['saveImages']>> = []
    if (decoded.length > 0) {
      const attachments = this.attachments()
      if (attachments === undefined) throw new NoticeError(503, 'DEPENDENCY_UNAVAILABLE', '图片存储暂不可用，请稍后重试')
      try {
        // The real batch API fully decodes/normalizes every input before committing any attachment.
        refs = await attachments.saveImages(decoded)
      } catch (error) {
        if (isImageAdmissionError(error)) throw new NoticeError(400, error.code, '截图格式不正确或超出图片限制')
        throw new NoticeError(503, 'DEPENDENCY_UNAVAILABLE', '图片存储暂不可用，请稍后重试')
      }
    }
    const row: WebsiteFeedbackRecord = {
      ...input, id: id('wf'), createdAt: new Date().toISOString(), status: 'open',
      images: refs.map(attachment => ({ id: id('wi'), attachment })),
    }
    await this.domain.table('website_feedback').put(row.id, row)
    return { id: row.id, createdAt: row.createdAt }
  }

  listFeedback(actor: IdentityActor, query: URLSearchParams) {
    requireWebsiteAdmin(actor)
    const integer = (key: string, fallback: number, min: number, max: number): number => {
      const text = query.get(key)
      if (text === null) return fallback
      const number = /^\d+$/.test(text) ? Number(text) : NaN
      if (!Number.isSafeInteger(number) || number < min || number > max) throw new NoticeError(400, 'BAD_REQUEST', '分页参数不正确')
      return number
    }
    const offset = integer('offset', 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = integer('limit', 50, 1, 100)
    const status = query.get('status')
    if (status !== null && !['open', 'answered', 'closed'].includes(status)) throw new NoticeError(400, 'BAD_REQUEST', '反馈状态不正确')
    const rows = [...this.domain.table('website_feedback').entries()].map(([, row]) => row)
      .filter(row => status === null || row.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    return { feedback: rows.slice(offset, offset + limit).map(feedbackView), total: rows.length }
  }

  async replyFeedback(actor: IdentityActor, feedbackId: string, body: unknown) {
    requireWebsiteAdmin(actor)
    const input = parse(websiteReplyWire, body)
    const table = this.domain.table('website_feedback')
    if (table.get(feedbackId) === undefined) throw new NoticeError(404, 'NOT_FOUND', '反馈不存在')
    const updated = await table.update(feedbackId, current => ({
      ...current, ...input, repliedBy: actor.userKey, repliedAt: new Date().toISOString(),
    }))
    return feedbackView(updated)
  }

  async readFeedbackImage(actor: IdentityActor, feedbackId: string, imageId: string) {
    requireWebsiteAdmin(actor)
    const row = this.domain.table('website_feedback').get(feedbackId)
    const image = row?.images.find(value => value.id === imageId)
    if (image === undefined) throw new NoticeError(404, 'NOT_FOUND', '截图不存在')
    const attachments = this.attachments()
    if (attachments === undefined) throw new NoticeError(503, 'DEPENDENCY_UNAVAILABLE', '图片存储暂不可用')
    const { name, originalDimensions, ...reference } = image.attachment
    try { return await attachments.readImage({
      ...reference,
      ...(name === undefined ? {} : { name }),
      ...(originalDimensions === undefined ? {} : { originalDimensions }),
    }) }
    catch { throw new NoticeError(503, 'DEPENDENCY_UNAVAILABLE', '图片读取暂不可用') }
  }
}
