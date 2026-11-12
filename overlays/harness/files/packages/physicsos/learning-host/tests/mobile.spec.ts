import { describe, expect, it } from 'vitest'
import { student } from '../../mobile-host/tests/fixture.ts'
import { checkpoint, learningFixture, scene, sceneBody } from './mobile-fixture.ts'

describe('real mobile learning facade', () => {
  it('persists and reopens the complete checkpoint and exports content rather than only metadata', async () => {
    const f = learningFixture()
    const body = sceneBody()
    const saved = await f.facade.saveScene(student, body.sceneId, body, 'mutation-first')
    expect(saved).toMatchObject({ appliedRevision: 1, replayed: false, item: { sceneId: body.sceneId, revision: 1, hasCheckpoint: true } })
    expect((await f.facade.getScene(student, body.sceneId)).item).toMatchObject({ scene: body.scene, originScene: body.originScene, checkpoint: body.checkpoint })
    expect(await f.facade.exportScene(student, body.sceneId, 1)).toMatchObject({ checkpoint: body.checkpoint })
    expect(f.storage.reopen().domain.table('saved_scenes').size).toBe(1)
  })

  it('rejects incomplete, inconsistent or unsupported checkpoints without replacing the prior scene', async () => {
    const mutations: ((body: ReturnType<typeof sceneBody>) => unknown)[] = [
      body => ({ ...body, checkpoint: { version: 1 } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, playback: { rate: 1 } } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, editing: { ...body.checkpoint.editing, source: { kind: 'not-a-source' } } } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, history: { ...body.checkpoint.history, past: [{ ...body.checkpoint.history.past[0], before: scene('foreign-history-id') }] } } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, history: { ...body.checkpoint.history, past: [...body.checkpoint.history.past, ...body.checkpoint.history.past] } } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, editing: { ...body.checkpoint.editing, draft: { note: 'not a circuit draft' } } } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, scene: scene(body.sceneId, 'checkpoint differs from envelope') } }),
      body => ({ ...body, checkpoint: { ...body.checkpoint, extra: true } }),
    ]
    for (const mutate of mutations) {
      const f = learningFixture()
      await f.facade.saveScene(student, 'scene-one', sceneBody(), 'original-save')
      await expect(f.facade.saveScene(student, 'scene-one', mutate(sceneBody('scene-one', checkpoint(), 1)), 'invalid-save')).rejects.toMatchObject({ status: 400 })
      expect(f.files.saves).toBe(1)
      expect((await f.facade.getScene(student, 'scene-one')).item['revision']).toBe(1)
    }
  })

  it('enforces scene-pair and checkpoint byte limits independently, without trimming history', async () => {
    const f = learningFixture()
    const large = sceneBody('large-history', checkpoint('large-history', 100, 'x'.repeat(16_000)))
    expect(Buffer.byteLength(JSON.stringify(large.checkpoint))).toBeGreaterThan(2 * 1024 * 1024)
    await expect(f.facade.saveScene(student, large.sceneId, large, 'large-history-save')).resolves.toMatchObject({ appliedRevision: 1 })
    expect((await f.facade.getScene(student, large.sceneId)).item['checkpoint']).toEqual(large.checkpoint)
    const huge = sceneBody('huge-history', checkpoint('huge-history', 260, 'x'.repeat(17_000)))
    await expect(f.facade.saveScene(student, huge.sceneId, huge, 'huge-history-save')).rejects.toMatchObject({ status: 413, code: 'CHECKPOINT_TOO_LARGE' })
    const pair = checkpoint('huge-pair')
    pair.scene = scene('huge-pair', 'x'.repeat(1_100_000)); pair.originScene = scene('huge-pair', 'x'.repeat(1_100_000))
    await expect(f.facade.saveScene(student, 'huge-pair', sceneBody('huge-pair', pair), 'huge-pair-save')).rejects.toMatchObject({ status: 413 })
  })

  it('keeps replay appliedRevision separate from the current head and rejects stale follow-ups', async () => {
    const f = learningFixture()
    const original = sceneBody()
    await f.facade.saveScene(student, 'scene-one', original, 'device-a-one')
    await f.facade.saveScene(student, 'scene-one', { ...original, title: 'Device B', baseRevision: 1 }, 'device-b-two')
    expect(await f.facade.saveScene(student, 'scene-one', original, 'device-a-one')).toMatchObject({ appliedRevision: 1, replayed: true, item: { revision: 2 } })
    await expect(f.facade.saveScene(student, 'scene-one', { ...original, title: 'Device A follow-up', baseRevision: 1 }, 'device-a-three')).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    expect((await f.facade.getScene(student, 'scene-one')).item['title']).toBe('Device B')
  })

  it('exports tombstones, refuses changed export revisions and fails when cloud bytes are unavailable', async () => {
    const f = learningFixture()
    await f.facade.saveScene(student, 'scene-one', sceneBody(), 'first-save')
    f.files.unavailable = true
    await expect(f.facade.exportScene(student, 'scene-one', 1)).rejects.toMatchObject({ status: 503 })
    f.files.unavailable = false
    await f.facade.deleteScene(student, 'scene-one', { baseRevision: 1 }, 'delete-one')
    const tombstone = f.facade.listScenes(student)[0]!
    expect(tombstone).toHaveProperty('deletedAt')
    expect(tombstone).not.toHaveProperty('title')
    expect(await f.facade.exportScene(student, 'scene-one', 2)).toEqual(tombstone)
    await expect(f.facade.exportScene(student, 'scene-one', 1)).rejects.toMatchObject({ status: 409, code: 'EXPORT_CHANGED' })
  })

  it('never changes roles or lets another account read a saved scene', async () => {
    const f = learningFixture()
    await f.facade.saveScene(student, 'scene-one', sceneBody(), 'first-save')
    await expect(f.facade.getScene({ ...student, userKey: 'school:other', userId: 'other' }, 'scene-one')).rejects.toMatchObject({ status: 404 })
    expect(() => f.facade.listScenes({ ...student, role: 'SUPER_ADMIN' })).toThrowError('移动学习入口仅供学生本人使用')
    expect(() => f.facade.listScenes({ ...student, userId: '' })).toThrowError('缺少有效账户实例')
  })
})
