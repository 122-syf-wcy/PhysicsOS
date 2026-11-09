/** Real-filesystem checks for immutable Canvas bytes, private paths, and disposal. */
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test as baseTest, vi } from 'vitest'
import {
  CanvasBlobStore,
  canvasDigest,
  canvasHash,
  canvasScopeKey,
  type CanvasBlobScope,
} from '../src/canvas-blob-store.ts'
import { CanvasError } from '../src/canvas-error.ts'

const owner: CanvasBlobScope = {
  schoolId: 'GZU',
  userKey: 'GZU:student-a',
  canvasId: 'canvas-a',
}

// BlobStore receives complete canonical bytes; it does not parse or canonicalize them.
const canonicalText = '{"kind":"state","payload":{"label":"振子 λ","position":1,"velocity":0},"schemaVersion":1}'
const fixtureBytes = (): Uint8Array => new TextEncoder().encode(canonicalText)

const documentDirectory = (root: string, scope: CanvasBlobScope): string => join(
  root,
  'accounts',
  canvasScopeKey(scope.schoolId, scope.userKey),
  'documents',
  canvasScopeKey(scope.canvasId),
)
const stagingDirectory = (root: string, scope: CanvasBlobScope): string => join(documentDirectory(root, scope), 'staging')
const objectFile = (root: string, scope: CanvasBlobScope, digest: string): string => join(
  documentDirectory(root, scope),
  'objects',
  digest.slice(0, 2),
  digest,
)

const verificationAttemptFile = (root: string, scope: CanvasBlobScope, digest: string): string => join(
  documentDirectory(root, scope),
  'verification-attempts',
  digest.slice(0, 2),
  digest,
)

const test = baseTest.extend('files', async ({}, { onCleanup }) => {
  // /tmp and /var are symlinks on macOS; only the owned test paths may be symlink subjects.
  const home = await mkdtemp(join(await realpath(tmpdir()), 'physicsos-canvas-blob-'))
  const stores = new Set<CanvasBlobStore>()
  const releases = new Set<() => void>()
  onCleanup(async () => {
    for (const release of releases) release()
    try {
      await Promise.all([...stores].map(store => store.close()))
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  const root = join(home, 'physicsos', 'canvases', 'v1')
  const createStore = (location = root): CanvasBlobStore => {
    const store = new CanvasBlobStore(location)
    stores.add(store)
    return store
  }
  return {
    home,
    root,
    store: createStore(),
    createStore,
    releaseOnCleanup: (release: () => void): void => { releases.add(release) },
  }
})

async function expectCanvasError(
  operation: Promise<unknown>,
  status: number,
  code: string,
): Promise<CanvasError> {
  expect(operation).toBeInstanceOf(Promise)
  await expect(operation).rejects.toBeInstanceOf(CanvasError)
  try {
    await operation
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasError)
    if (!(error instanceof CanvasError)) throw error
    expect(error.status).toBe(status)
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected CanvasError ${code}, but the operation succeeded.`)
}

function publishBytes(store: CanvasBlobStore, scope: CanvasBlobScope, bytes: Uint8Array) {
  return store.publish(scope, canvasHash(bytes), [bytes], {
    expectedBytes: bytes.byteLength,
    maxBytes: bytes.byteLength,
  })
}

function publishAttemptBytes(store: CanvasBlobStore, scope: CanvasBlobScope, bytes: Uint8Array) {
  return store.publishVerificationAttempt(scope, canvasHash(bytes), bytes, {
    expectedBytes: bytes.byteLength,
    maxBytes: bytes.byteLength,
  })
}

function pausedStream(
  files: { releaseOnCleanup: (release: () => void) => void },
  bytes: Uint8Array,
  failure?: Error,
) {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let finalized = false
  files.releaseOnCleanup(() => released.resolve())
  async function* chunks() {
    try {
      yield bytes.subarray(0, 1)
      // The next pull occurs after the real staging handle has written the first byte.
      entered.resolve()
      await released.promise
      if (failure !== undefined) throw failure
      yield bytes.subarray(1)
    } finally {
      finalized = true
    }
  }
  return {
    chunks: chunks(),
    entered: entered.promise,
    release: (): void => { released.resolve() },
    finalized: (): boolean => finalized,
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  expect(info.isDirectory()).toBe(true)
  expect(info.isSymbolicLink()).toBe(false)
  expect(info.mode & 0o777).toBe(0o700)
  if (typeof process.getuid === 'function') expect(info.uid).toBe(process.getuid())
}

const invalidDigests = [
  { name: 'empty digest', value: '' },
  { name: 'short digest', value: 'a'.repeat(63) },
  { name: 'long digest', value: 'a'.repeat(65) },
  { name: 'uppercase digest', value: 'A'.repeat(64) },
  { name: 'non-hex digest', value: 'g'.repeat(64) },
  { name: 'parent traversal', value: `../${'a'.repeat(64)}` },
  { name: 'embedded traversal', value: `${'a'.repeat(64)}/../../outside` },
  { name: 'absolute path', value: `/${'a'.repeat(64)}` },
  { name: 'Windows traversal', value: `..\\${'a'.repeat(64)}` },
  { name: 'trailing newline', value: `${'a'.repeat(64)}\n` },
  { name: 'trailing carriage return', value: `${'a'.repeat(64)}\r` },
  { name: 'NUL suffix', value: `${'a'.repeat(64)}\0` },
]

const invalidScopes: { name: string, value: CanvasBlobScope }[] = [
  { name: 'empty school', value: { ...owner, schoolId: '' } },
  { name: 'empty account', value: { ...owner, userKey: '' } },
  { name: 'empty document', value: { ...owner, canvasId: '' } },
  { name: 'overlong document', value: { ...owner, canvasId: 'a'.repeat(129) } },
  { name: 'parent traversal', value: { ...owner, canvasId: '../outside' } },
  { name: 'embedded traversal', value: { ...owner, canvasId: 'canvas/../../outside' } },
  { name: 'absolute document path', value: { ...owner, canvasId: '/outside' } },
  { name: 'Windows document traversal', value: { ...owner, canvasId: '..\\outside' } },
  { name: 'trailing document newline', value: { ...owner, canvasId: 'canvas-a\n' } },
  { name: 'NUL document suffix', value: { ...owner, canvasId: 'canvas-a\0' } },
]

describe('Canvas byte addresses', () => {
  test('hashes exact bytes and preserves identity tuple boundaries', () => {
    const bytes = new TextEncoder().encode('abc')
    expect(canvasHash(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(canvasDigest(canvasHash(bytes))).toBe(canvasHash(bytes))
    expect(canvasHash(new TextEncoder().encode(`${canonicalText}\n`))).not.toBe(canvasHash(fixtureBytes()))
    expect(canvasScopeKey('ab', 'c')).not.toBe(canvasScopeKey('a', 'bc'))
    expect(canvasScopeKey('school:user', 'account')).not.toBe(canvasScopeKey('school', 'user:account'))
    expect(canvasScopeKey('school', 'account')).not.toBe(canvasScopeKey('account', 'school'))
    expect(canvasScopeKey('../school', '../../user')).toMatch(/^[a-f0-9]{64}$/)
  })

  for (const { name, value } of invalidDigests) {
    test(`rejects ${name} as an object address`, () => {
      expect(() => canvasDigest(value)).toThrow(CanvasError)
    })
  }

  test('requires the versioned Canvas directory layout before acquiring files', () => {
    expect(() => new CanvasBlobStore(join(tmpdir(), 'unallocated-canvas', 'objects')))
      .toThrow('CanvasBlobStore root must be <DSH_HOME>/physicsos/canvases/v1')
  })
})

// Windows lacks the Linux production directory-fsync, O_NOFOLLOW, and POSIX owner-mode semantics.
describe.skipIf(process.platform === 'win32')('CanvasBlobStore real POSIX filesystem', () => {
  test('initialize creates private directories and is idempotent', async ({ files }) => {
    await expect(lstat(files.root)).rejects.toMatchObject({ code: 'ENOENT' })
    await Promise.all([files.store.initialize(), files.store.initialize()])
    for (const directory of [files.home, join(files.home, 'physicsos'), dirname(files.root), files.root]) {
      await assertPrivateDirectory(directory)
    }
    expect(await readdir(files.root)).toEqual([])
  })

  test('publishes complete canonical UTF-8 bytes without truncation or re-encoding', async ({ files }) => {
    await files.store.initialize()
    const expected = fixtureBytes()
    const supplied = expected.slice()
    const digest = canvasHash(expected)
    const split = supplied.findIndex(byte => byte > 0x7f) + 1
    expect(split).toBeGreaterThan(0)
    async function* chunks() {
      yield supplied.subarray(0, split)
      yield new Uint8Array()
      yield supplied.subarray(split, split + 1)
      yield supplied.subarray(split + 1)
    }
    const reference = await files.store.publish(owner, digest, chunks(), {
      expectedBytes: expected.byteLength,
      maxBytes: expected.byteLength,
    })
    expect(reference).toEqual({ digest, bytes: expected.byteLength })
    supplied.fill(0)
    const path = objectFile(files.root, owner, digest)
    const actual = await readFile(path)
    expect(new Uint8Array(actual)).toEqual(expected)
    expect(actual.byteLength).toBe(reference.bytes)
    expect(canvasHash(actual)).toBe(reference.digest)
    const read = await files.store.read(owner, digest, reference.bytes, reference.bytes)
    expect(new Uint8Array(read)).toEqual(expected)
    read.fill(0)
    expect(new Uint8Array(await files.store.read(owner, digest, reference.bytes, reference.bytes))).toEqual(expected)
    expect(await readdir(dirname(path))).toEqual([digest])
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
  })

  for (const mismatch of ['digest', 'complete byte count']) {
    test(`rejects a mismatched ${mismatch} without publishing a file`, async ({ files }) => {
      await files.store.initialize()
      const expected = fixtureBytes()
      const supplied = expected.slice()
      if (mismatch === 'digest') supplied.set(Uint8Array.of(0), 0)
      const chunks = mismatch === 'digest' ? [supplied] : [supplied.subarray(0, supplied.byteLength - 1)]
      const digest = canvasHash(expected)
      await expectCanvasError(files.store.publish(owner, digest, chunks, {
        expectedBytes: expected.byteLength,
        maxBytes: expected.byteLength,
      }), 400, 'DIGEST_MISMATCH')
      const path = objectFile(files.root, owner, digest)
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(dirname(path))).toEqual([])
      expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
    })
  }

  for (const scenario of [
    { name: 'a single oversized chunk', cumulative: false, extraCapacity: 0 },
    { name: 'cumulatively oversized chunks', cumulative: true, extraCapacity: 0 },
    { name: 'bytes beyond the declaration but within the configured maximum', cumulative: true, extraCapacity: 1 },
  ]) {
    test(`rejects ${scenario.name} and finalizes the stream`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const oversized = new Uint8Array(bytes.byteLength + 1)
      oversized.set(bytes)
      let finalized = false
      let resumedAfterOversize = false
      async function* chunks() {
        try {
          if (scenario.cumulative) {
            yield bytes
            yield Uint8Array.of(0)
          } else {
            yield oversized
          }
          resumedAfterOversize = true
        } finally {
          finalized = true
        }
      }
      const digest = canvasHash(bytes)
      await expectCanvasError(files.store.publish(owner, digest, chunks(), {
        expectedBytes: bytes.byteLength,
        maxBytes: bytes.byteLength + scenario.extraCapacity,
      }), 413, 'OBJECT_TOO_LARGE')
      expect(finalized).toBe(true)
      expect(resumedAfterOversize).toBe(false)
      const path = objectFile(files.root, owner, digest)
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(dirname(path))).toEqual([])
      expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
    })
  }

  test('rejects a declaration over maxBytes before acquiring a staging file', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    let pulled = false
    async function* chunks() {
      pulled = true
      yield bytes
    }
    await expectCanvasError(files.store.publish(owner, canvasHash(bytes), chunks(), {
      expectedBytes: bytes.byteLength,
      maxBytes: bytes.byteLength - 1,
    }), 413, 'OBJECT_TOO_LARGE')
    expect(pulled).toBe(false)
    expect(await readdir(files.root)).toEqual([])
  })

  test('deduplicates EEXIST only after verifying the existing immutable file', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const first = await publishBytes(files.store, owner, bytes)
    const path = objectFile(files.root, owner, first.digest)
    const before = await lstat(path)
    const repeated = await files.store.publish(owner, first.digest, [bytes.subarray(0, 1), bytes.subarray(1)], {
      expectedBytes: bytes.byteLength,
      maxBytes: bytes.byteLength,
    })
    expect(repeated).toEqual(first)
    const after = await lstat(path)
    expect(after.ino).toBe(before.ino)
    expect(after.dev).toBe(before.dev)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.mode & 0o777).toBe(0o400)
    expect(after.nlink).toBe(1)
    expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    expect(await readdir(dirname(path))).toEqual([first.digest])
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
  })

  for (const corruption of ['same-length different bytes', 'truncated bytes']) {
    test(`rejects EEXIST with ${corruption} rather than overwriting it`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const reference = await publishBytes(files.store, owner, bytes)
      const path = objectFile(files.root, owner, reference.digest)
      const corrupt = corruption === 'truncated bytes' ? bytes.slice(0, bytes.byteLength - 1) : bytes.slice()
      if (corruption === 'same-length different bytes') corrupt.set(Uint8Array.of(0), 0)
      await chmod(path, 0o600)
      await writeFile(path, corrupt)
      await chmod(path, 0o400)
      const before = await lstat(path)
      await expectCanvasError(publishBytes(files.store, owner, bytes), 503, 'BLOB_CORRUPT')
      expect(new Uint8Array(await readFile(path))).toEqual(corrupt)
      const after = await lstat(path)
      expect(after.ino).toBe(before.ino)
      expect(after.dev).toBe(before.dev)
      expect(await readdir(dirname(path))).toEqual([reference.digest])
      expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
    })
  }

  for (const corruption of ['same-length hash corruption', 'truncated file', 'appended file']) {
    test(`reports ${corruption} as a lazy-read integrity error after reopening`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const reference = await publishBytes(files.store, owner, bytes)
      const path = objectFile(files.root, owner, reference.digest)
      await files.store.close()
      let corrupt = bytes.slice()
      if (corruption === 'same-length hash corruption') corrupt.set(Uint8Array.of(0), 0)
      if (corruption === 'truncated file') corrupt = bytes.slice(0, bytes.byteLength - 1)
      if (corruption === 'appended file') {
        corrupt = new Uint8Array(bytes.byteLength + 1)
        corrupt.set(bytes)
      }
      await chmod(path, 0o600)
      await writeFile(path, corrupt)
      await chmod(path, 0o400)
      const reopened = files.createStore()
      await reopened.initialize()
      await expectCanvasError(reopened.read(owner, reference.digest, reference.bytes, reference.bytes), 503, 'BLOB_CORRUPT')
      expect(new Uint8Array(await readFile(path))).toEqual(corrupt)
    })
  }

  test('reports a missing referenced file as an error and removes absence idempotently', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const reference = await publishBytes(files.store, owner, bytes)
    const path = objectFile(files.root, owner, reference.digest)
    await unlink(path)
    await expectCanvasError(files.store.read(owner, reference.digest, reference.bytes, reference.bytes), 503, 'BLOB_MISSING')
    await files.store.remove(owner, reference.digest)
    await files.store.remove(owner, reference.digest)
    expect(await readdir(dirname(path))).toEqual([])
  })

  test('enforces the current complete-byte read limit and authoritative metadata length', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const reference = await publishBytes(files.store, owner, bytes)
    await expectCanvasError(files.store.read(owner, reference.digest, reference.bytes, reference.bytes - 1), 413, 'OBJECT_TOO_LARGE')
    await expectCanvasError(files.store.read(owner, reference.digest, reference.bytes - 1, reference.bytes), 503, 'BLOB_CORRUPT')
    expect(new Uint8Array(await files.store.read(owner, reference.digest, reference.bytes, reference.bytes))).toEqual(bytes)
  })

  test('keeps the same digest in different account and document paths without fallback access', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const digest = canvasHash(bytes)
    const otherScopes: CanvasBlobScope[] = [
      { ...owner, userKey: 'GZU:student-b' },
      { ...owner, schoolId: 'GZNU' },
      { ...owner, canvasId: 'canvas-b' },
    ]
    await publishBytes(files.store, owner, bytes)
    for (const scope of otherScopes) {
      await expectCanvasError(files.store.read(scope, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
      await files.store.remove(scope, digest)
      expect(new Uint8Array(await readFile(objectFile(files.root, owner, digest)))).toEqual(bytes)
    }
    await Promise.all(otherScopes.map(scope => publishBytes(files.store, scope, bytes)))
    const scopes = [owner, ...otherScopes]
    const paths = scopes.map(scope => objectFile(files.root, scope, digest))
    expect(new Set(paths).size).toBe(scopes.length)
    const infos = await Promise.all(paths.map(path => lstat(path)))
    expect(new Set(infos.map(info => `${info.dev}:${info.ino}`)).size).toBe(scopes.length)
    for (const scope of scopes) {
      expect(new Uint8Array(await files.store.read(scope, digest, bytes.byteLength, bytes.byteLength))).toEqual(bytes)
    }
    await files.store.remove(otherScopes[0]!, digest)
    await expect(lstat(paths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const path of [paths[0]!, ...paths.slice(2)]) expect(new Uint8Array(await readFile(path))).toEqual(bytes)
  })

  test('keeps server verification attempts separate from ordinary objects and other scopes', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const digest = canvasHash(bytes)
    const otherScope: CanvasBlobScope = { ...owner, userKey: 'GZU:student-b', canvasId: 'canvas-b' }
    const attempt = await publishAttemptBytes(files.store, owner, bytes)
    expect(attempt).toEqual({ digest, bytes: bytes.byteLength })
    await expectCanvasError(files.store.read(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
    await expectCanvasError(files.store.readVerificationAttempt(otherScope, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
    await publishBytes(files.store, otherScope, bytes)
    await expectCanvasError(files.store.readVerificationAttempt(otherScope, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
    await publishAttemptBytes(files.store, otherScope, bytes)
    await publishBytes(files.store, owner, bytes)
    const paths = [
      objectFile(files.root, owner, digest),
      verificationAttemptFile(files.root, owner, digest),
      objectFile(files.root, otherScope, digest),
      verificationAttemptFile(files.root, otherScope, digest),
    ]
    expect(new Set(paths).size).toBe(4)
    const infos = await Promise.all(paths.map(path => lstat(path)))
    expect(new Set(infos.map(info => `${info.dev}:${info.ino}`)).size).toBe(4)
    for (const [index, path] of paths.entries()) {
      const info = infos[index]!
      expect(info.isFile()).toBe(true)
      expect(info.mode & 0o777).toBe(0o400)
      expect(info.nlink).toBe(1)
      expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    }
    const privatePath = verificationAttemptFile(files.root, owner, digest)
    const before = await lstat(privatePath)
    expect(await publishAttemptBytes(files.store, owner, bytes)).toEqual(attempt)
    const after = await lstat(privatePath)
    expect(after.dev).toBe(before.dev)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    await files.store.remove(owner, digest)
    expect(new Uint8Array(await files.store.readVerificationAttempt(owner, digest, bytes.byteLength, bytes.byteLength))).toEqual(bytes)
    await expectCanvasError(files.store.read(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
    await files.store.removeVerificationAttempt(otherScope, digest)
    await files.store.removeVerificationAttempt(otherScope, digest)
    expect(new Uint8Array(await files.store.read(otherScope, digest, bytes.byteLength, bytes.byteLength))).toEqual(bytes)
    await expectCanvasError(files.store.readVerificationAttempt(otherScope, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_MISSING')
    for (const scope of [owner, otherScope]) expect(await readdir(stagingDirectory(files.root, scope))).toEqual([])
  })

  test('rejects a corrupt server attempt without falling back to the valid ordinary object', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const digest = canvasHash(bytes)
    await publishBytes(files.store, owner, bytes)
    await publishAttemptBytes(files.store, owner, bytes)
    const path = verificationAttemptFile(files.root, owner, digest)
    await files.store.close()
    const corrupt = bytes.slice()
    corrupt.set(Uint8Array.of(0), 0)
    await chmod(path, 0o600)
    await writeFile(path, corrupt)
    await chmod(path, 0o400)
    const before = await lstat(path)
    const reopened = files.createStore()
    await reopened.initialize()
    await expectCanvasError(reopened.readVerificationAttempt(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_CORRUPT')
    await expectCanvasError(publishAttemptBytes(reopened, owner, bytes), 503, 'BLOB_CORRUPT')
    expect(new Uint8Array(await readFile(path))).toEqual(corrupt)
    const after = await lstat(path)
    expect(after.dev).toBe(before.dev)
    expect(after.ino).toBe(before.ino)
    expect(new Uint8Array(await reopened.read(owner, digest, bytes.byteLength, bytes.byteLength))).toEqual(bytes)
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
  })

  test('hashes identity path characters rather than interpreting them as directories', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const scope: CanvasBlobScope = { schoolId: '../../school', userKey: '../account/secret', canvasId: 'canvas-a' }
    const reference = await publishBytes(files.store, scope, bytes)
    const accountKey = canvasScopeKey(scope.schoolId, scope.userKey)
    expect(await readdir(join(files.root, 'accounts'))).toEqual([accountKey])
    expect(await readdir(join(files.root, 'accounts', accountKey, 'documents'))).toEqual([canvasScopeKey(scope.canvasId)])
    expect(new Uint8Array(await readFile(objectFile(files.root, scope, reference.digest)))).toEqual(bytes)
    expect(await readdir(files.home)).toEqual(['physicsos'])
  })

  for (const { name, value } of invalidScopes) {
    test(`rejects ${name} in every scoped operation without creating paths`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const digest = canvasHash(bytes)
      await expectCanvasError(publishBytes(files.store, value, bytes), 400, 'BAD_REQUEST')
      await expectCanvasError(files.store.read(value, digest, bytes.byteLength, bytes.byteLength), 400, 'BAD_REQUEST')
      await expectCanvasError(files.store.remove(value, digest), 400, 'BAD_REQUEST')
      await expectCanvasError(files.store.collectStaging(value, 0), 400, 'BAD_REQUEST')
      expect(await readdir(files.root)).toEqual([])
    })
  }

  test('rejects malformed digests before consuming bytes or acquiring scoped files', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    let pulled = false
    async function* chunks() {
      pulled = true
      yield bytes
    }
    for (const { value } of invalidDigests) {
      await expectCanvasError(files.store.publish(owner, value, chunks(), {
        expectedBytes: bytes.byteLength,
        maxBytes: bytes.byteLength,
      }), 400, 'BAD_DIGEST')
      await expectCanvasError(files.store.read(owner, value, bytes.byteLength, bytes.byteLength), 400, 'BAD_DIGEST')
      await expectCanvasError(files.store.remove(owner, value), 400, 'BAD_DIGEST')
    }
    expect(pulled).toBe(false)
    expect(await readdir(files.root)).toEqual([])
  })

  test('refuses a symbolic-link root during initialization without touching its target', async ({ files }) => {
    const outside = join(files.home, 'outside')
    await mkdir(outside, { mode: 0o700 })
    const sentinel = join(outside, 'sentinel')
    await writeFile(sentinel, 'private target', { mode: 0o600 })
    await mkdir(dirname(files.root), { recursive: true, mode: 0o700 })
    await symlink(outside, files.root, 'dir')
    await expectCanvasError(files.store.initialize(), 503, 'BLOB_UNSAFE_PATH')
    expect((await lstat(files.root)).isSymbolicLink()).toBe(true)
    expect(await readdir(outside)).toEqual(['sentinel'])
    expect(await readFile(sentinel, 'utf8')).toBe('private target')
  })

  for (const pathKind of ['account symbolic link', 'document symbolic link', 'bucket symbolic link', 'non-directory bucket']) {
    test(`refuses an unsafe ${pathKind} without following or replacing it`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const digest = canvasHash(bytes)
      const outside = join(files.home, 'outside')
      await mkdir(outside, { mode: 0o700 })
      await writeFile(join(outside, 'sentinel'), bytes, { mode: 0o600 })
      let unsafe = dirname(objectFile(files.root, owner, digest))
      if (pathKind === 'account symbolic link') unsafe = join(files.root, 'accounts', canvasScopeKey(owner.schoolId, owner.userKey))
      if (pathKind === 'document symbolic link') unsafe = documentDirectory(files.root, owner)
      await mkdir(dirname(unsafe), { recursive: true, mode: 0o700 })
      if (pathKind === 'non-directory bucket') await writeFile(unsafe, bytes, { mode: 0o600 })
      else await symlink(outside, unsafe, 'dir')
      await expectCanvasError(publishBytes(files.store, owner, bytes), 503, 'BLOB_UNSAFE_PATH')
      await expectCanvasError(files.store.read(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_UNSAFE_PATH')
      await expectCanvasError(files.store.remove(owner, digest), 503, 'BLOB_UNSAFE_PATH')
      expect(await readdir(outside)).toEqual(['sentinel'])
      expect(new Uint8Array(await readFile(join(outside, 'sentinel')))).toEqual(bytes)
      const info = await lstat(unsafe)
      expect(info.isSymbolicLink()).toBe(pathKind !== 'non-directory bucket')
      if (pathKind === 'non-directory bucket') expect(new Uint8Array(await readFile(unsafe))).toEqual(bytes)
    })
  }

  test('rejects an object symlink on read, EEXIST publication, and removal', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const digest = canvasHash(bytes)
    const outside = join(files.home, 'outside-object')
    await writeFile(outside, bytes, { mode: 0o400 })
    const path = objectFile(files.root, owner, digest)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await symlink(outside, path, 'file')
    await expectCanvasError(files.store.read(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'BLOB_UNSAFE_PATH')
    await expectCanvasError(publishBytes(files.store, owner, bytes), 503, 'BLOB_UNSAFE_PATH')
    await expectCanvasError(files.store.remove(owner, digest), 503, 'BLOB_UNSAFE_PATH')
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect(new Uint8Array(await readFile(outside))).toEqual(bytes)
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
  })

  test('rejects readable object bytes when group or other permissions expose the file', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const reference = await publishBytes(files.store, owner, bytes)
    const path = objectFile(files.root, owner, reference.digest)
    await chmod(path, 0o444)
    await expectCanvasError(files.store.read(owner, reference.digest, reference.bytes, reference.bytes), 503, 'BLOB_UNSAFE_PATH')
    await expectCanvasError(publishBytes(files.store, owner, bytes), 503, 'BLOB_UNSAFE_PATH')
    expect((await lstat(path)).mode & 0o777).toBe(0o444)
    expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
  })

  test('collects only expired staging directories in the selected document', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const reference = await publishBytes(files.store, owner, bytes)
    const staging = stagingDirectory(files.root, owner)
    const expiredFile = join(staging, 'upload-expired-file')
    const expiredEmpty = join(staging, 'upload-expired-empty')
    const active = join(staging, 'upload-active')
    const future = join(staging, 'upload-future')
    for (const path of [expiredFile, expiredEmpty, active, future]) await mkdir(path, { mode: 0o700 })
    for (const path of [expiredFile, active, future]) await writeFile(join(path, 'object'), bytes, { mode: 0o600 })
    const old = new Date('2000-01-01T00:00:00.000Z')
    const activeTime = new Date('2020-01-01T00:00:00.000Z')
    const futureTime = new Date('2030-01-01T00:00:00.000Z')
    await utimes(expiredFile, old, old)
    await utimes(expiredEmpty, old, old)
    await utimes(active, activeTime, activeTime)
    await utimes(future, futureTime, futureTime)
    // The inclusive active boundary uses the filesystem's actual timestamp precision.
    const cutoff = (await lstat(active)).mtimeMs
    const otherScope: CanvasBlobScope = { ...owner, canvasId: 'other-canvas' }
    const otherExpired = join(stagingDirectory(files.root, otherScope), 'upload-expired')
    await mkdir(otherExpired, { recursive: true, mode: 0o700 })
    await writeFile(join(otherExpired, 'object'), bytes, { mode: 0o600 })
    await utimes(otherExpired, old, old)
    expect(await files.store.collectStaging(owner, cutoff)).toBe(2)
    expect((await readdir(staging)).sort()).toEqual(['upload-active', 'upload-future'])
    await expect(lstat(expiredFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(expiredEmpty)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const path of [active, future, otherExpired]) expect(new Uint8Array(await readFile(join(path, 'object')))).toEqual(bytes)
    expect(new Uint8Array(await readFile(objectFile(files.root, owner, reference.digest)))).toEqual(bytes)
    expect(await files.store.collectStaging(owner, cutoff)).toBe(0)
    expect(await files.store.collectStaging({ ...owner, canvasId: 'absent-canvas' }, cutoff)).toBe(0)
    expect(await files.store.collectStaging(otherScope, cutoff)).toBe(1)
    await expect(lstat(otherExpired)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('resyncs an empty staging directory after a failed post-removal fsync', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const staging = stagingDirectory(files.root, owner)
    const abandoned = join(staging, 'upload-expired')
    await mkdir(abandoned, { recursive: true, mode: 0o700 })
    await writeFile(join(abandoned, 'object'), bytes, { mode: 0o600 })
    const old = new Date('2000-01-01T00:00:00.000Z')
    await utimes(abandoned, old, old)
    const cutoff = (await lstat(abandoned)).mtimeMs + 1000
    const ownedInfo = await lstat(staging)
    const probe = await open(join(files.home, 'staging-sync-probe'), 'wx', 0o600)
    let methods: Pick<FileHandle, 'sync'>
    try {
      methods = Object.getPrototypeOf(probe)
    } finally {
      await probe.close()
    }
    const originalSync = methods.sync
    const syncFailure = new Error('Owned staging directory sync failed after removal.')
    let syncCalls = 0
    // Retry must persist the earlier deletions even though its directory scan finds no entries.
    const spy = vi.spyOn(methods, 'sync').mockImplementation(async function (this: FileHandle) {
      const info = await this.stat()
      if (info.dev === ownedInfo.dev && info.ino === ownedInfo.ino) {
        syncCalls += 1
        if (syncCalls === 1) {
          expect(await readdir(staging)).toEqual([])
          throw syncFailure
        }
      }
      await originalSync.call(this)
    })
    files.releaseOnCleanup(() => spy.mockRestore())
    try {
      const error = await expectCanvasError(files.store.collectStaging(owner, cutoff), 503, 'BLOB_DELETE_FAILED')
      expect(error.cause).toBe(syncFailure)
      expect(syncCalls).toBe(1)
      await expect(lstat(abandoned)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(staging)).toEqual([])
      expect(await files.store.collectStaging(owner, cutoff)).toBe(0)
      expect(syncCalls).toBeGreaterThanOrEqual(2)
      expect(await readdir(staging)).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  for (const entryKind of ['unexpected directory', 'ordinary file', 'unexpected leaf', 'symbolic-link directory']) {
    test(`refuses an unsafe staging ${entryKind}`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const staging = stagingDirectory(files.root, owner)
      await mkdir(staging, { recursive: true, mode: 0o700 })
      const entry = join(staging, entryKind === 'unexpected directory' ? 'unexpected' : 'upload-unsafe')
      const outside = join(files.home, 'outside')
      await mkdir(outside, { mode: 0o700 })
      await writeFile(join(outside, 'sentinel'), bytes, { mode: 0o600 })
      if (entryKind === 'ordinary file') await writeFile(entry, bytes, { mode: 0o600 })
      else if (entryKind === 'symbolic-link directory') await symlink(outside, entry, 'dir')
      else {
        await mkdir(entry, { mode: 0o700 })
        if (entryKind === 'unexpected leaf') await writeFile(join(entry, 'unexpected'), bytes, { mode: 0o600 })
      }
      const cutoff = (await lstat(entry)).mtimeMs + 1000
      await expectCanvasError(files.store.collectStaging(owner, cutoff), 503, 'BLOB_UNSAFE_PATH')
      expect(await readdir(staging)).toEqual([entryKind === 'unexpected directory' ? 'unexpected' : 'upload-unsafe'])
      expect(new Uint8Array(await readFile(join(outside, 'sentinel')))).toEqual(bytes)
      if (entryKind === 'unexpected leaf') expect(new Uint8Array(await readFile(join(entry, 'unexpected')))).toEqual(bytes)
    })
  }

  for (const fails of [false, true]) {
    test(`close waits for a held stream to ${fails ? 'fail and clean up' : 'publish a private immutable file'}`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const digest = canvasHash(bytes)
      const streamFailure = fails ? new Error('Owned stream failed after its barrier.') : undefined
      const stream = pausedStream(files, bytes, streamFailure)
      const publication = files.store.publish(owner, digest, stream.chunks, {
        expectedBytes: bytes.byteLength,
        maxBytes: bytes.byteLength,
      })
      let publicationSettled = false
      const publicationState = publication.then(
        value => { publicationSettled = true; return { ok: true, value } },
        (error: unknown) => { publicationSettled = true; return { ok: false, error } },
      )
      await Promise.race([
        stream.entered,
        publication.then(() => { throw new Error('Publication completed before the stream barrier.') }),
      ])
      const staging = stagingDirectory(files.root, owner)
      const entries = await readdir(staging)
      expect(entries).toHaveLength(1)
      const temporary = join(staging, entries[0]!)
      expect(entries[0]).toMatch(/^upload-/)
      const document = documentDirectory(files.root, owner)
      for (const path of [
        files.home,
        files.root,
        join(files.root, 'accounts'),
        dirname(dirname(document)),
        dirname(document),
        document,
        staging,
        temporary,
        dirname(objectFile(files.root, owner, digest)),
      ]) await assertPrivateDirectory(path)
      const leaf = await lstat(join(temporary, 'object'))
      expect(leaf.isFile()).toBe(true)
      expect(leaf.mode & 0o777).toBe(0o600)
      if (typeof process.getuid === 'function') expect(leaf.uid).toBe(process.getuid())
      expect(new Uint8Array(await readFile(join(temporary, 'object')))).toEqual(bytes.subarray(0, 1))
      const closing = files.store.close()
      expect(files.store.close()).toBe(closing)
      let closeSettled = false
      const closeState = closing.then(
        () => { closeSettled = true; return { ok: true } },
        (error: unknown) => { closeSettled = true; return { ok: false, error } },
      )
      await expectCanvasError(files.store.initialize(), 503, 'CLOSED')
      await expectCanvasError(publishBytes(files.store, owner, bytes), 503, 'CLOSED')
      await expectCanvasError(files.store.read(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'CLOSED')
      await expectCanvasError(files.store.remove(owner, digest), 503, 'CLOSED')
      await expectCanvasError(files.store.collectStaging(owner, 0), 503, 'CLOSED')
      await expectCanvasError(publishAttemptBytes(files.store, owner, bytes), 503, 'CLOSED')
      await expectCanvasError(files.store.readVerificationAttempt(owner, digest, bytes.byteLength, bytes.byteLength), 503, 'CLOSED')
      await expectCanvasError(files.store.removeVerificationAttempt(owner, digest), 503, 'CLOSED')
      expect(await readdir(staging)).toEqual(entries)
      expect(closeSettled).toBe(false)
      expect(publicationSettled).toBe(false)
      expect(stream.finalized()).toBe(false)
      stream.release()
      await closing
      expect(await closeState).toEqual({ ok: true })
      expect(publicationSettled).toBe(true)
      expect(stream.finalized()).toBe(true)
      const path = objectFile(files.root, owner, digest)
      if (fails) {
        const error = await expectCanvasError(publication, 503, 'BLOB_WRITE_FAILED')
        expect(error.cause).toBe(streamFailure)
        await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      } else {
        expect(await publication).toEqual({ digest, bytes: bytes.byteLength })
        const final = await lstat(path)
        expect(final.isFile()).toBe(true)
        expect(final.mode & 0o777).toBe(0o400)
        expect(final.nlink).toBe(1)
        if (typeof process.getuid === 'function') expect(final.uid).toBe(process.getuid())
        expect(new Uint8Array(await readFile(path))).toEqual(bytes)
      }
      await publicationState
      expect(await readdir(staging)).toEqual([])
      expect((await lstat(staging)).isDirectory()).toBe(true)
      await files.store.close()
    })
  }

  test('awaits staged-file cleanup when a held publication is aborted', async ({ files }) => {
    await files.store.initialize()
    const bytes = fixtureBytes()
    const digest = canvasHash(bytes)
    const controller = new AbortController()
    const stream = pausedStream(files, bytes)
    const publication = files.store.publish(owner, digest, stream.chunks, {
      expectedBytes: bytes.byteLength,
      maxBytes: bytes.byteLength,
      signal: controller.signal,
    })
    const observed = publication.then(value => ({ value }), (error: unknown) => ({ error }))
    await Promise.race([
      stream.entered,
      publication.then(() => { throw new Error('Publication completed before the stream barrier.') }),
    ])
    const reason = new Error('Owned upload was cancelled.')
    controller.abort(reason)
    const closing = files.store.close()
    stream.release()
    await expect(publication).rejects.toBe(reason)
    await closing
    await observed
    expect(stream.finalized()).toBe(true)
    expect(await readdir(stagingDirectory(files.root, owner))).toEqual([])
    await expect(lstat(objectFile(files.root, owner, digest))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  for (const syncSubject of ['staged file', 'publication directory']) {
    test(`rejects publication when the real ${syncSubject} cannot be fsynced`, async ({ files }) => {
      await files.store.initialize()
      const bytes = fixtureBytes()
      const digest = canvasHash(bytes)
      const stream = pausedStream(files, bytes)
      const publication = files.store.publish(owner, digest, stream.chunks, {
        expectedBytes: bytes.byteLength,
        maxBytes: bytes.byteLength,
      })
      const observed = publication.then(value => ({ value }), (error: unknown) => ({ error }))
      await Promise.race([
        stream.entered,
        publication.then(() => { throw new Error('Publication completed before the stream barrier.') }),
      ])
      const staging = stagingDirectory(files.root, owner)
      const entries = await readdir(staging)
      expect(entries).toHaveLength(1)
      const subject = syncSubject === 'staged file'
        ? join(staging, entries[0]!, 'object')
        : dirname(objectFile(files.root, owner, digest))
      const ownedInfo = await lstat(subject)
      const probe = await open(join(files.home, 'handle-probe'), 'wx', 0o600)
      let methods: Pick<FileHandle, 'sync'>
      try {
        methods = Object.getPrototypeOf(probe)
      } finally {
        await probe.close()
      }
      const originalSync = methods.sync
      const syncFailure = new Error('Owned filesystem sync failed.')
      let injected = false
      // Only the held publication's real inode fails; every other handle performs its real fsync.
      const spy = vi.spyOn(methods, 'sync').mockImplementation(async function (this: FileHandle) {
        const info = await this.stat()
        if (!injected && info.dev === ownedInfo.dev && info.ino === ownedInfo.ino) {
          injected = true
          throw syncFailure
        }
        await originalSync.call(this)
      })
      files.releaseOnCleanup(() => spy.mockRestore())
      try {
        stream.release()
        const error = await expectCanvasError(publication, 503, 'BLOB_WRITE_FAILED')
        expect(error.cause).toBe(syncFailure)
        expect(injected).toBe(true)
      } finally {
        spy.mockRestore()
        stream.release()
        await observed
      }
      expect(stream.finalized()).toBe(true)
      expect(await readdir(staging)).toEqual([])
      const path = objectFile(files.root, owner, digest)
      if (syncSubject === 'staged file') await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      else {
        expect(new Uint8Array(await readFile(path))).toEqual(bytes)
        expect(new Uint8Array(await files.store.read(owner, digest, bytes.byteLength, bytes.byteLength))).toEqual(bytes)
        await files.store.remove(owner, digest)
        await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    })
  }
})
