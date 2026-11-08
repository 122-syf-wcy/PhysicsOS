/** Website configuration and private intake schemas share one durable vocabulary. */
import { z } from 'zod'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'

export const websiteId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
const order = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const url = z.string().trim().max(2048).refine(value => {
  if (value === '') return true
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname !== ''
      && parsed.username === '' && parsed.password === ''
  } catch { return false }
}, '必须是无凭据的完整 HTTP(S) 地址')

export const websiteTestimonial = z.object({
  id: websiteId,
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().max(60),
  quote: z.string().trim().min(1).max(280),
  topic: z.string().trim().max(32),
  color, order, enabled: z.boolean(),
  sourceFeedbackId: websiteId.optional(),
}).strict()

export const websiteContributor = z.object({
  id: websiteId,
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().max(60),
  project: z.string().trim().min(1).max(70),
  description: z.string().trim().max(220),
  url, avatar: url, color, order, enabled: z.boolean(),
}).strict()

const uniqueIds = (items: readonly { id: string }[]): boolean => new Set(items.map(item => item.id)).size === items.length
const contentFields = {
  testimonials: z.array(websiteTestimonial).max(12).refine(uniqueIds, '条目 ID 不能重复'),
  contributors: z.array(websiteContributor).max(12).refine(uniqueIds, '条目 ID 不能重复'),
}
export const websiteContent = z.object({
  ...contentFields,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.string(), updatedBy: z.string().min(1),
})
export const websiteContentWire = z.object({
  ...contentFields, expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
}).strict()

export const websiteImageMediaType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const dimensions = z.object({ width: z.number().int().positive(), height: z.number().int().positive() })
const attachment = z.object({
  attachmentId: z.string().min(1).transform(AttachmentId),
  mediaType: websiteImageMediaType,
  bytes: z.number().int().positive(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  name: z.string().optional(), originalDimensions: dimensions.optional(),
})
export const websiteFeedback = z.object({
  id: websiteId,
  kind: z.enum(['bug', 'content', 'idea', 'other']),
  body: z.string().trim().min(5).max(2000),
  contact: z.string().trim().max(100).optional(),
  context: z.string().trim().max(400).optional(),
  status: z.enum(['open', 'answered', 'closed']),
  reply: z.string().optional(), repliedBy: z.string().optional(), repliedAt: z.string().optional(),
  createdAt: z.string(),
  images: z.array(z.object({ id: websiteId, attachment })).max(3),
})
export const websiteFeedbackWire = websiteFeedback.pick({ kind: true, body: true, contact: true, context: true }).extend({
  images: z.array(z.object({
    data: z.string().min(1).max(4 * Math.ceil(5 * 1024 * 1024 / 3)),
    mediaType: websiteImageMediaType, name: z.string().max(255).optional(),
  }).strict()).max(3).optional(),
}).strict()
export const websiteReplyWire = z.object({
  reply: z.string().trim().min(1).max(2000),
  status: z.enum(['answered', 'closed']),
}).strict()

export type WebsiteContentRecord = z.infer<typeof websiteContent>
export type WebsiteFeedbackRecord = z.infer<typeof websiteFeedback>
