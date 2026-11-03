import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { openDeveloperPromptDomain } from '../src/prompt-domain.ts'
import { DeveloperPromptService } from '../src/prompt-service.ts'
import {
  importPromptMarkdown,
  renderPrompt,
  validateBody,
  validPromptDocument,
} from '../src/prompt-format.ts'
import { admin, contributor, schoolAdmin } from './fixtures.ts'

export const seed = {
  body: '## 开发说明\n\n保留真实光线。',
  binding: {
    release: {
      schemaVersion: 2 as const,
      experimentId: 'convex-lens' as const,
      url: `/physicsos/developers/downloads/physicsos-experiment-template-v2-${'a'.repeat(64)}.zip`,
      sha256: 'a'.repeat(64),
      bytes: 1234,
    },
    contractMarkdown: '## 固定规范\n\nschemaVersion: 2；protocolVersion: 2；执行 npm run release。',
  },
}
let cleanup: (() => Promise<void>) | undefined
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'prompt-domain-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const domain = await openDeveloperPromptDomain(ctx)
  const service = new DeveloperPromptService(domain, seed)
  await service.initialize()
  cleanup = async () => {
    await service.close()
    await domain.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  return { domain, service }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await cleanup?.()
  cleanup = undefined
})
const saveBody = (
  expectedRevision: number,
  version = '1.1.0',
  body = '## 材质\n\n使用蓝色底板。',
) => ({ expectedRevision, version, body, note: '改善材质' })

describe('shared developer prompt Markdown', () => {
  it.each(['\uD800', '\uDC00'])(
    'rejects unpaired Unicode surrogates instead of silently replacing exported bytes',
    (value) => {
      expect(() => validateBody(value)).toThrow()
    },
  )
  it('preserves valid non-BMP Unicode in author text', () => {
    expect(validateBody('🧪 实验说明')).toBe('🧪 实验说明')
  })
  it('exports real immutable binding and roundtrips only the editable section', () => {
    const markdown = renderPrompt(
      { version: '1.1.0', body: '# 自定义\n\n保留光线。', binding: seed.binding },
      'https://candidate.example',
      '提高触摸体验',
    )
    expect(markdown).toContain('提示词版本：1.1.0')
    expect(markdown).toContain(`https://candidate.example${seed.binding.release.url}`)
    expect(markdown).toContain('schemaVersion: 2')
    expect(markdown).toContain('提高触摸体验')
    expect(importPromptMarkdown(markdown)).toBe('# 自定义\n\n保留光线。')
    expect(importPromptMarkdown('\uFEFF# 中文\r\n\r\n说明。\r\n')).toBe('# 中文\n\n说明。\n')
  })
  it.each(['', '   ', 'a\u0000b', 'a\u001bb', 'x'.repeat(65537), '中'.repeat(21846)])(
    'rejects invalid or oversized body without treating characters as bytes',
    (body) => {
      expect(() => validateBody(body)).toThrow()
    },
  )
  it.each([
    '<!-- physicsos:editable:start -->\nx',
    '<!-- physicsos:editable:end -->',
    '<!-- physicsos:contract:start -->x',
    '<!-- physicsos:editable:start -->x<!-- physicsos:editable:start -->',
  ])('rejects incomplete/duplicated export markers', (text) => {
    expect(() => importPromptMarkdown(text)).toThrow()
  })
  it('does not accept malformed public identities or untrusted template locations', async () => {
    const { service } = await setup()
    const current = service.current()
    expect(validPromptDocument(current)).toBe(true)
    expect(
      validPromptDocument({
        ...current,
        binding: {
          ...current.binding,
          release: { ...current.binding.release, url: 'https://attacker.example/template.zip' },
        },
      }),
    ).toBe(false)
    expect(validPromptDocument({ ...current, version: '01.0.0' })).toBe(false)
    expect(validPromptDocument({ ...current, body: '<!-- physicsos:editable:start -->' })).toBe(
      false,
    )
  })
})

describe('developer prompt publication', () => {
  it('preserves significant Markdown indentation and trailing line breaks through save, export and import', async () => {
    const { service } = await setup()
    const body = '    const x = 1\n    const y = 2\n\n保留硬换行  \n'
    const saved = await service.save(admin, saveBody(0, '1.1.0', body))
    expect(saved.draft?.body).toBe(body)
    const published = (await service.publish(admin, { expectedRevision: 1 })).current
    expect(published.body).toBe(body)
    const exported = renderPrompt(published, 'https://candidate.example')
    expect(importPromptMarkdown(exported)).toBe(body)
    const imported = await service.import(admin, {
      expectedRevision: 2,
      version: '1.2.0',
      note: '',
      filename: 'code.md',
      base64: Buffer.from(exported).toString('base64'),
    })
    expect(imported.draft?.body).toBe(body)
    expect(importPromptMarkdown('\uFEFF' + body.replaceAll('\n', '\r\n'))).toBe(body)
  })
  it.each(['header', 'fixed', 'suffix', 'plain'])(
    'rejects disallowed controls anywhere in an imported %s document without changing the draft',
    async (position) => {
      const { service } = await setup()
      const exported = renderPrompt({ version: '1.1.0', ...seed }, 'https://candidate.example')
      const text =
        position === 'header'
          ? '\u0000' + exported
          : position === 'fixed'
            ? exported.replace('## 固定规范', '## 固定规范\u001b')
            : position === 'suffix'
              ? exported + '\u000c'
              : '\u000b正文\u000c'
      await expect(
        service.import(admin, {
          expectedRevision: 0,
          version: '1.1.0',
          note: '',
          filename: 'prompt.md',
          base64: Buffer.from(text).toString('base64'),
        }),
      ).rejects.toMatchObject({ status: 400 })
      expect(service.admin(admin)).toMatchObject({ revision: 0, draft: null })
    },
  )
  it('keeps digests and draft bindings stable when JSON storage reorders object keys', async () => {
    const { domain, service } = await setup()
    await service.save(admin, saveBody(0))
    const first = (await service.publish(admin, { expectedRevision: 1 })).current
    const reordered = {
      contractMarkdown: seed.binding.contractMarkdown,
      release: {
        bytes: seed.binding.release.bytes,
        sha256: seed.binding.release.sha256,
        url: seed.binding.release.url,
        experimentId: seed.binding.release.experimentId,
        schemaVersion: seed.binding.release.schemaVersion,
      },
    }
    const state = structuredClone(domain.table('state').get('convex-lens'))!
    state.versions[0]!.binding = reordered
    await domain.table('state').put('convex-lens', state)
    const reopened = new DeveloperPromptService(domain, { ...seed, binding: reordered })
    await reopened.initialize()
    expect(reopened.current()).toEqual(first)
    await reopened.save(admin, saveBody(2, '1.2.0'))
    const reconfigured = new DeveloperPromptService(domain, seed)
    await reconfigured.initialize()
    expect((await reconfigured.publish(admin, { expectedRevision: 3 })).current.version).toBe(
      '1.2.0',
    )
  })
  it('keeps saved/imported drafts private until explicit publish and freezes the published version', async () => {
    const { service } = await setup()
    expect(service.current()).toMatchObject({
      id: 'system-default',
      publishedAt: null,
      body: seed.body,
    })
    const draft = await service.save(admin, saveBody(0))
    expect(draft.revision).toBe(1)
    expect(service.current().body).toBe(seed.body)
    const released = await service.publish(admin, { expectedRevision: 1 })
    expect(released.current).toMatchObject({ version: '1.1.0', body: '## 材质\n\n使用蓝色底板。' })
    expect(released.draft).toBeNull()
    expect(released.current.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(service.current()).not.toHaveProperty('publishedBy')
    expect(service.current()).not.toHaveProperty('note')
    expect(service.current()).not.toHaveProperty('draft')
    await expect(service.save(admin, saveBody(2))).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_EXISTS',
    })
    const leaked = service.current()
    leaked.binding.contractMarkdown = 'tamper'
    expect(service.current().binding.contractMarkdown).toBe(seed.binding.contractMarkdown)
    expect(service.published(released.current.id)).toEqual(released.current)
  })
  it('rejects stale concurrent writes and restores exact old content while retaining later history', async () => {
    const { service } = await setup()
    const outcomes = await Promise.allSettled([
      service.save(admin, saveBody(0)),
      service.save(admin, saveBody(0, '1.2.0', '其他编辑')),
    ])
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({
      reason: { status: 409, code: 'REVISION_CONFLICT' },
    })
    const first = (await service.publish(admin, { expectedRevision: 1 })).current
    await service.save(admin, saveBody(2, '1.2.0', '第二版'))
    const second = (await service.publish(admin, { expectedRevision: 3 })).current
    await expect(
      service.activate(admin, {
        expectedRevision: 4,
        id: first.id,
        expectedSha256: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ status: 409 })
    const result = await service.activate(admin, {
      expectedRevision: 4,
      id: first.id,
      expectedSha256: first.sha256,
    })
    expect(result.current).toEqual(first)
    expect(result.versions.map(item => item.id)).toContain(second.id)
    expect(service.published(second.id)).toEqual(second)
  })
  it('does not let school admins read drafts or mutate prompt state', async () => {
    const { service } = await setup()
    for (const actor of [contributor, schoolAdmin]) {
      expect(() => service.admin(actor)).toThrow()
      await expect(service.save(actor, saveBody(0))).rejects.toMatchObject({ status: 403 })
      await expect(service.publish(actor, { expectedRevision: 0 })).rejects.toMatchObject({
        status: 403,
      })
    }
    expect(service.admin(admin).revision).toBe(0)
  })
  it('requires saving and previewing again after the deployed binding changes', async () => {
    const { domain, service } = await setup()
    await service.save(admin, saveBody(0))
    const updated = new DeveloperPromptService(domain, {
      ...seed,
      binding: { ...seed.binding, contractMarkdown: '新固定规范' },
    })
    await updated.initialize()
    await expect(updated.publish(admin, { expectedRevision: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'BINDING_CHANGED',
    })
    await updated.save(admin, saveBody(1))
    expect(
      (await updated.publish(admin, { expectedRevision: 2 })).current.binding.contractMarkdown,
    ).toBe('新固定规范')
  })
  it('preserves the live state after a failed persistence write and validates persisted digests', async () => {
    const { domain, service } = await setup()
    vi.spyOn(domain.table('state'), 'put').mockRejectedValueOnce(new Error('disk full'))
    await expect(service.save(admin, saveBody(0))).rejects.toThrow('disk full')
    expect(service.admin(admin).revision).toBe(0)
    await service.save(admin, saveBody(0))
    await service.publish(admin, { expectedRevision: 1 })
    const reopened = new DeveloperPromptService(domain, seed)
    await reopened.initialize()
    expect(reopened.current()).toEqual(service.current())
    const state = structuredClone(domain.table('state').get('convex-lens'))!
    state.versions[0]!.body = '被篡改'
    await domain.table('state').put('convex-lens', state)
    await expect(new DeveloperPromptService(domain, seed).initialize()).rejects.toThrow()
  })
  it('imports normalized editable Markdown but refuses binary, invalid UTF8 and excess bytes', async () => {
    const { service } = await setup()
    const imported = await service.import(admin, {
      expectedRevision: 0,
      version: '2.0.0',
      note: '',
      filename: '说明.MD',
      base64: Buffer.from('\uFEFF# 中文\r\n说明').toString('base64'),
    })
    expect(imported.draft?.body).toBe('# 中文\n说明')
    for (const [filename, bytes] of [
      ['bad.html', Buffer.from('ok')],
      ['bad.md', Buffer.from([0xff])],
      ['bad.md', Buffer.from('x\u0000')],
      ['bad.md', Buffer.alloc(131073, 97)],
    ] as const) {
      await expect(
        service.import(admin, {
          expectedRevision: 1,
          version: '2.0.0',
          note: '',
          filename,
          base64: bytes.toString('base64'),
        }),
      ).rejects.toMatchObject({ status: 400 })
    }
    expect(service.admin(admin).revision).toBe(1)
    expect(service.current().id).toBe('system-default')
  })
  it('restores prior durable state when a rejected write actually committed', async () => {
    const { domain, service } = await setup()
    await service.save(admin, saveBody(0))
    const table = domain.table('state')
    const original = table.put.bind(table)
    vi.spyOn(table, 'put').mockImplementationOnce(async (key, value) => {
      await original(key, value)
      throw new Error('late write failure')
    })
    await expect(service.publish(admin, { expectedRevision: 1 })).rejects.toThrow(
      'late write failure',
    )
    const reopened = new DeveloperPromptService(domain, seed)
    await reopened.initialize()
    expect(reopened.current().id).toBe('system-default')
    expect(reopened.admin(admin).draft?.version).toBe('1.1.0')
  })
  it('refuses reads and subsequent writes when durable recovery also fails', async () => {
    const { domain, service } = await setup()
    vi.spyOn(domain.table('state'), 'put').mockRejectedValue(new Error('storage unavailable'))
    await expect(service.save(admin, saveBody(0))).rejects.toThrow('storage unavailable')
    expect(() => service.current()).toThrow()
    await expect(service.save(admin, saveBody(0))).rejects.toMatchObject({
      status: 503,
      code: 'STATE_UNCERTAIN',
    })
  })
})
