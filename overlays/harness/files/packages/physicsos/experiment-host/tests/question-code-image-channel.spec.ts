import { crc32, deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createQuestionCodeImageAssets } from '../src/question-code-image-channel.ts'
import { visualMaterialGeneratedMetadata } from '../src/visual-material-domain.ts'
import type { VisualMaterialService } from '../src/visual-material-contracts.ts'

const chunk = (name: string, bytes: Buffer): Buffer => {
  const tag = Buffer.from(name), head = Buffer.alloc(4), checksum = Buffer.alloc(4)
  head.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([tag, bytes])))
  return Buffer.concat([head, tag, bytes, checksum])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.alloc(64 * 257))), chunk('IEND', Buffer.alloc(0))])
const scope = { ownerSessionId: 'owner-session', ownerKey: 'owner', generationId: 'image-job', sceneSha256: 'a'.repeat(64) }

function setup() {
  const generateImage = vi.fn(async (_request: { prompt: string }) => ({ bytes: png, mediaType: 'image/png' as const,
    model: 'image-model', channelId: 'image-channel', configRevision: 'image-config', usage: { totalTokens: 10 } }))
  const storeGenerated = vi.fn<VisualMaterialService['storeGenerated']>(async (_actor, input) => {
    const checked = visualMaterialGeneratedMetadata(input)
    return { id: 'material-result', revision: 1, sha256: createHash('sha256').update(input.bytes).digest('hex'), byteLength: input.bytes.byteLength,
      mediaType: checked.mediaType, width: checked.width, height: checked.height, kind: checked.kind, model: checked.model,
      theme: checked.theme, purpose: checked.purpose, tags: checked.tags, lifecycle: 'ready', visibility: 'private',
      createdAt: 1, updatedAt: 1, metadataTrust: 'untrusted' }
  })
  const assets = createQuestionCodeImageAssets({ channels: () => ({ generateImage }), materials: { storeGenerated },
    actorForSession: (_session, expected) => ({ userKey: expected, schoolId: 'school' }), assertBinding: () => {} })
  return { assets, generateImage, storeGenerated }
}

it('retains a valid 5000-character original brief without overflowing private metadata after the platform prefix', async () => {
  const h = setup(), prompt = 'x'.repeat(5000)
  const image = await h.assets.generate({ ...scope, prompt, kind: 'environment', signal: new AbortController().signal })
  expect(h.generateImage).toHaveBeenCalledOnce()
  expect(h.generateImage.mock.calls[0]![0].prompt.length).toBeGreaterThan(5000)
  expect(h.generateImage.mock.calls[0]![0].prompt).toContain('No text, numbers, formulas')
  expect(h.storeGenerated).toHaveBeenCalledOnce()
  expect(h.storeGenerated.mock.calls[0]![1]).toMatchObject({ prompt, sourceJobId: scope.generationId,
    generationChannelId: 'image-channel', generationConfigRevision: 'image-config', generationUsage: { totalTokens: 10 } })
  expect(image).toMatchObject({ materialId: 'material-result', materialRevision: 1 })
})

it('rejects a NUL brief before a paid image request or library operation', async () => {
  const h = setup()
  await expect(h.assets.generate({ ...scope, prompt: 'wood\0private', kind: 'environment', signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID' })
  expect(h.generateImage).not.toHaveBeenCalled()
  expect(h.storeGenerated).not.toHaveBeenCalled()
})
