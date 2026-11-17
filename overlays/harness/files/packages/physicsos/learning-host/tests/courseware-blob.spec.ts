import { mkdtemp, readFile, rm, chmod, symlink, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CoursewareBlobStore, coursewareHash, coursewareKey } from '../src/courseware-blob-store.ts'
const scope = { schoolId: 'school', userKey: 'teacher', deckId: 'deck_1' }
async function fixture() { const home = await mkdtemp(join(tmpdir(), 'cw-blob-')); const root = join(home, 'physicsos', 'courseware', 'v1'); const blobs = new CoursewareBlobStore(root); onTestFinished(async () => { await blobs.close(); await rm(home, { recursive: true, force: true }) }); return { home, root, blobs } }
describe('private immutable courseware files', () => {
  it('publishes exclusively and verifies the complete digest and private owner on reads', async () => {
    const f = await fixture(); await f.blobs.initialize(); const bytes = Buffer.from('complete original HTML\r\n')
    const ref = await f.blobs.publish(scope, bytes, 1024, 256 * 1024 * 1024)
    expect(ref).toEqual({ digest: coursewareHash(bytes), bytes: bytes.byteLength })
    expect(await f.blobs.publish(scope, bytes, 1024, 256 * 1024 * 1024)).toEqual(ref)
    expect(await f.blobs.read(scope, ref, 1024)).toEqual(bytes)
    await expect(f.blobs.read({ ...scope, userKey: 'other' }, ref, 1024)).rejects.toBeDefined()
    await expect(f.blobs.publish(scope, bytes, 1, 256 * 1024 * 1024)).rejects.toMatchObject({ code: 'BLOB_LIMIT' })
    const path = join(f.root, coursewareKey(scope.schoolId, scope.userKey), coursewareKey(scope.deckId), ref.digest)
    expect(await readFile(path)).toEqual(bytes)
    await writeFile(path, Buffer.alloc(bytes.byteLength, 32))
    await expect(f.blobs.read(scope, ref, 1024)).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' })
  })
  it('rejects symlink roots and object paths, and a read-only bridge never repairs loose permissions', async () => {
    const f = await fixture(); const target = join(f.home, 'target'); await mkdir(target); await mkdir(dirname(f.root), { recursive: true, mode: 0o700 }); await symlink(target, f.root)
    await expect(f.blobs.initialize()).rejects.toMatchObject({ code: 'UNSAFE_STORAGE' })
    await rm(f.root); await f.blobs.initialize(); await chmod(f.root, 0o755)
    await expect(f.blobs.initialize(true)).rejects.toMatchObject({ code: 'UNSAFE_STORAGE' })
  })
  it('checks free disk and request cancellation without publishing partial/truncated bytes', async () => {
    const f = await fixture(); await f.blobs.initialize(); const bytes = Buffer.alloc(1024, 1)
    vi.spyOn(f.blobs, 'freeBytes').mockResolvedValue(1024)
    await expect(f.blobs.publish(scope, bytes, 2048, 256 * 1024 * 1024)).rejects.toMatchObject({ code: 'DISK_RESERVE' })
    const abort = new AbortController(); abort.abort()
    await expect(f.blobs.publish(scope, bytes, 2048, 256 * 1024 * 1024, abort.signal)).rejects.toBeDefined()
  })
})
