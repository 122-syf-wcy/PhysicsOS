import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { LocalAttachmentStore } from '../../../attachment/attachment-local/src/index.ts'
import { InMemoryLimiterBackend, type LimiterPolicy } from '../../auth-host/src/limiter.ts'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'
import * as noticeHost from '../src/index.ts'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
const testimonial = (id: string, order = 0, enabled = true) => ({
  id, name: '真实使用者', role: '教师', quote: '这是一条经过同意展示的真实反馈。',
  topic: '实验', color: '#335577', order, enabled,
})
const contributor = { id: 'person', name: '贡献者', role: '教师', project: '实验项目',
  description: '真实项目说明', url: 'https://example.org/project', avatar: '',
  color: '#445566', order: 0, enabled: true }

let ctx: Context
let root: string
let base: string
let limiterFails: boolean
let backend: InMemoryLimiterBackend
const audit: { action: string; detail?: Record<string, unknown> }[] = []

const identity: PhysicsosIdentity = {
  actorOf(req) {
    const role = req.headers.cookie?.replace('role=', '') as IdentityRole | undefined
    if (role === undefined || !['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(role)) return null
    return { role, userKey: `school:${role}`, schoolId: 'school', username: role } satisfies IdentityActor
  },
  async record(_actor, action, _target, detail) { audit.push({ action, ...(detail === undefined ? {} : { detail }) }) },
}

async function boot(trustedProxies: string[] = [], withLimiter = true) {
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'storage') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  ctx.provide('physicsosIdentity', identity)
  if (withLimiter) ctx.provide('physicsosRateLimiter', {
    kind: 'memory',
    consume(policy: LimiterPolicy, key: string, now?: number) {
      if (limiterFails) throw new Error('backend offline')
      return backend.consume(policy, key, now)
    },
  })
  await ctx.plugin(noticeHost, { trustedProxies })
  base = `http://127.0.0.1:${ctx.webServer.port}`
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'website-notice-'))
  limiterFails = false
  backend = new InMemoryLimiterBackend()
  audit.length = 0
  await boot()
})
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 20))
  await ctx?.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

const call = (path: string, role?: IdentityRole, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/physicsos/notice${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(role === undefined ? {} : { cookie: `role=${role}` }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const save = (body: unknown) => call('/website', 'SUPER_ADMIN', 'PUT', body)
const submit = (body: unknown, headers: Record<string, string> = {}) => call('/public/website-feedback', undefined, 'POST', body, headers)
const report = { kind: 'bug', body: '实验界面存在一个问题', contact: 'private@example.org', context: '/app/private-page' }

describe('website content and private feedback over real storage and attachments', () => {
  it('serves an honest anonymous empty state and starts private configuration at version zero', async () => {
    const response = await call('/public/website')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ testimonials: [], contributors: [] })
    const admin = await call('/website', 'SUPER_ADMIN')
    expect(admin.status).toBe(200)
    expect(await admin.json()).toEqual({ content: { version: 0, testimonials: [], contributors: [], updatedAt: '', updatedBy: '' } })
  })

  it('rejects every non-super-admin management read, write, reply and guessed image URL', async () => {
    for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN'] as const) {
      for (const path of ['/website', '/website-feedback', '/website-feedback/guessed/images/guessed']) {
        expect((await call(path, role)).status).toBe(403)
      }
      expect((await call('/website', role, 'PUT', { expectedVersion: 0, testimonials: [], contributors: [] })).status).toBe(403)
      expect((await call('/website-feedback/guessed/reply', role, 'POST', { reply: '越权回复', status: 'closed' })).status).toBe(403)
    }
    expect((await call('/website')).status).toBe(401)
    expect((await call('/website-feedback')).status).toBe(401)
  })

  it('publishes only enabled, ordered public fields and persists them across a real reopen', async () => {
    const response = await save({ expectedVersion: 0, testimonials: [testimonial('later', 2),
      { ...testimonial('first', 1), sourceFeedbackId: 'private-source' }, testimonial('hidden', 0, false)], contributors: [contributor] })
    expect(response.status).toBe(200)
    const content = (await response.json()).content
    expect(content.version).toBe(1)
    expect(content.updatedBy).toBe('school:SUPER_ADMIN')
    await ctx.fiber.dispose()
    await boot()
    const published = await (await call('/public/website')).json()
    expect(published.testimonials.map((item: { id: string }) => item.id)).toEqual(['first', 'later'])
    expect(published.testimonials[0]).not.toHaveProperty('sourceFeedbackId')
    expect(published).not.toHaveProperty('updatedBy')
    expect(published.contributors).toEqual([contributor])
    expect((await (await call('/website', 'SUPER_ADMIN')).json()).content).toEqual(content)
  })

  it('rejects concurrent stale saves without silently losing either accepted version', async () => {
    const [first, second] = await Promise.all([
      save({ expectedVersion: 0, testimonials: [testimonial('one')], contributors: [] }),
      save({ expectedVersion: 0, testimonials: [testimonial('two')], contributors: [] }),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    const content = (await (await call('/website', 'SUPER_ADMIN')).json()).content
    expect(content.version).toBe(1)
    expect((await save({ expectedVersion: 1, testimonials: [], contributors: [] })).status).toBe(200)
  })

  it('rejects duplicate ids, excessive arrays and invalid text, color, order and URLs', async () => {
    const badTestimonials = [
      [testimonial('a'), testimonial('a')], Array.from({ length: 13 }, (_, i) => testimonial(`id-${i}`)),
      [{ ...testimonial('a'), name: 'x'.repeat(41) }], [{ ...testimonial('a'), role: 'x'.repeat(61) }],
      [{ ...testimonial('a'), quote: 'x'.repeat(281) }], [{ ...testimonial('a'), topic: 'x'.repeat(33) }],
      [{ ...testimonial('a'), color: 'red' }], [{ ...testimonial('a'), order: -1 }],
      [{ ...testimonial('a'), order: 1.5 }], [{ ...testimonial('bad/id') }],
    ]
    for (const testimonials of badTestimonials) expect((await save({ expectedVersion: 0, testimonials, contributors: [] })).status).toBe(400)
    for (const avatar of ['javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:pass@example.org/avatar', '/relative.png']) {
      expect((await save({ expectedVersion: 0, testimonials: [], contributors: [{ ...contributor, avatar }] })).status).toBe(400)
    }
    for (const extra of [{ url: 'https://u:p@example.org' }, { project: 'x'.repeat(71) }, { description: 'x'.repeat(221) }]) {
      expect((await save({ expectedVersion: 0, testimonials: [], contributors: [{ ...contributor, ...extra }] })).status).toBe(400)
    }
  })

  it('stores and rereads real screenshot bytes only through the owning protected feedback route', async () => {
    const response = await submit({ ...report, images: [{ data: PNG, mediaType: 'image/png', name: '../../screenshot.png' }] })
    expect(response.status).toBe(201)
    const receipt = await response.json()
    expect(Object.keys(receipt).sort()).toEqual(['createdAt', 'id'])
    await ctx.fiber.dispose()
    await boot()
    const inbox = await (await call('/website-feedback', 'SUPER_ADMIN')).json()
    expect(inbox.total).toBe(1)
    expect(inbox.feedback[0]).toMatchObject({ ...report, id: receipt.id, status: 'open' })
    const screenshot = inbox.feedback[0].images[0]
    expect(screenshot.name).toBe('screenshot.png')
    expect(screenshot).not.toHaveProperty('attachmentId')
    expect(screenshot.url).toMatch(/^\/physicsos\/notice\/website-feedback\/.+\/images\/.+$/)
    const image = await fetch(`${base}${screenshot.url}`, { headers: { cookie: 'role=SUPER_ADMIN' } })
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('cache-control')).toBe('private, no-store')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(PNG, 'base64'))
    expect((await fetch(`${base}${screenshot.url}`, { headers: { cookie: 'role=SCHOOL_ADMIN' } })).status).toBe(403)
    expect((await call(`/website-feedback/wrong/images/${screenshot.id}`, 'SUPER_ADMIN')).status).toBe(404)
    expect((await (await call('/feedback', 'SUPER_ADMIN')).json()).items).toEqual([])
  })

  it('rejects malformed images and oversized submissions without creating feedback', async () => {
    const invalid = [
      { ...report, images: [{ data: 'not base64', mediaType: 'image/png' }] },
      { ...report, images: [{ data: Buffer.from('not an image').toString('base64'), mediaType: 'image/png' }] },
      { ...report, images: [{ data: PNG, mediaType: 'image/jpeg' }] },
      { ...report, images: Array.from({ length: 4 }, () => ({ data: PNG, mediaType: 'image/png' })) },
      { ...report, images: [{ data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'), mediaType: 'image/png' }] },
    ]
    for (const body of invalid) {
      backend = new InMemoryLimiterBackend()
      expect([400, 413]).toContain((await submit(body)).status)
    }
    expect((await (await call('/website-feedback', 'SUPER_ADMIN')).json()).total).toBe(0)
  })

  it('accepts image JSON over 64 KiB but keeps ordinary routes at 64 KiB', async () => {
    // A valid PNG permits trailing bytes; attachment validation still fully decodes the image.
    const large = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(70 * 1024)]).toString('base64')
    expect((await submit({ ...report, images: [{ data: large, mediaType: 'image/png' }] })).status).toBe(201)
    expect((await save({ expectedVersion: 0, testimonials: [], contributors: [], excess: 'x'.repeat(70 * 1024) })).status).toBe(413)
    expect((await submit({ ...report, excess: 'x'.repeat(22 * 1024 * 1024) })).status).toBe(413)
  })

  it('filters and paginates the inbox, persists replies, and audits no private body or images', async () => {
    const first = await (await submit(report)).json()
    await submit({ kind: 'idea', body: '第二条独立的反馈' })
    const reply = await call(`/website-feedback/${first.id}/reply`, 'SUPER_ADMIN', 'POST', { reply: '已确认，将安排修复。', status: 'answered' })
    expect(reply.status).toBe(200)
    expect((await reply.json()).feedback).toMatchObject({ status: 'answered', repliedBy: 'school:SUPER_ADMIN', reply: '已确认，将安排修复。' })
    const inbox = await (await call('/website-feedback?status=open&limit=1&offset=0', 'SUPER_ADMIN')).json()
    expect(inbox.total).toBe(1)
    expect(inbox.feedback).toHaveLength(1)
    expect(inbox.feedback[0].kind).toBe('idea')
    expect((await (await call('/website-feedback?offset=1&limit=1', 'SUPER_ADMIN')).json()).feedback).toHaveLength(1)
    for (const query of ['limit=101', 'offset=-1', 'limit=0', 'status=unknown', 'offset=1.5']) {
      expect((await call(`/website-feedback?${query}`, 'SUPER_ADMIN')).status).toBe(400)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(audit.some(entry => entry.action.includes('website'))).toBe(true)
    const serialized = JSON.stringify(audit)
    for (const privateValue of [report.body, report.contact, report.context, '已确认，将安排修复。', PNG]) expect(serialized).not.toContain(privateValue)
  })

  it('enforces anonymous JSON and origin checks, body bounds, and fail-closed shared limiting', async () => {
    expect((await submit(report, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await submit(report, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await submit(report, { 'content-type': 'text/plain' })).status).toBe(400)
    for (const patch of [{ body: '四个字' }, { body: 'x'.repeat(2001) }, { contact: 'x'.repeat(101) }, { context: 'x'.repeat(401) }]) {
      backend = new InMemoryLimiterBackend()
      expect((await submit({ ...report, ...patch })).status).toBe(400)
    }
    limiterFails = true
    expect((await submit(report)).status).toBe(503)
    expect((await (await call('/website-feedback', 'SUPER_ADMIN')).json()).total).toBe(0)
  })

  it('cannot bypass the limit by spoofing XFF from an untrusted direct peer', async () => {
    for (let i = 0; i < 3; i++) expect((await submit(report, { 'x-forwarded-for': `198.51.100.${i}` })).status).toBe(201)
    expect((await submit(report, { 'x-forwarded-for': '198.51.100.99' })).status).toBe(429)
  })

  it('separates clients only when their direct proxy is explicitly trusted', async () => {
    await ctx.fiber.dispose()
    await boot(['127.0.0.1'])
    for (let i = 0; i < 3; i++) expect((await submit(report, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(201)
    expect((await submit(report, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(429)
    expect((await submit(report, { 'x-forwarded-for': '198.51.100.2' })).status).toBe(201)
  })

  it('does not provide an unlimited fallback when no shared limiter is mounted', async () => {
    await ctx.fiber.dispose()
    await boot([], false)
    expect((await submit(report)).status).toBe(503)
  })
})
