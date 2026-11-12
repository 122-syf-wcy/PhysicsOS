import { describe, expect, it, vi } from 'vitest'
import { createApiPolicy, type ApiPolicyActor, type ApiPolicyStore } from '../src/api-policy.ts'

// Actual Fetch Request/Response streams; only auth resolution and the durable
// owner ledger are fixtures. No HTTP server, real account or model is involved.
const OWNER = 'school:student'
const BYTES = new Uint8Array([0, 255, 137, 80, 78, 71, 10, 13])
type CredentialKind = 'mobile' | 'api-token' | 'session'
function fixture(kind: CredentialKind = 'mobile', scope: 'read' | 'write' = 'write', role: ApiPolicyActor['role'] = 'STUDENT') {
  const actor: ApiPolicyActor = { userKey: OWNER, schoolId: 'school', username: 'student', role,
    credential: kind === 'mobile' ? { kind, grantId: 'fixture-grant', scope }
      : kind === 'api-token' ? { kind, tokenId: 'fixture-pat', scope } : { kind } }
  let live: ApiPolicyActor | null = actor
  const headers: Record<string, string> = kind === 'session'
    ? { cookie: 'physicsos_session=fixture' } : { authorization: `Bearer fixture-${kind}` }
  const resolve = vi.fn((cookie: string | undefined, authorization?: string) => {
    if (kind === 'session') return authorization === undefined && cookie === headers.cookie ? live : null
    return authorization === headers.authorization ? live : null
  })
  const owners = new Map([['owned', OWNER], ['foreign', 'school:someone-else']])
  const ownerKey = vi.fn((_kind: string, id: string) => owners.get(id))
  // Deliberately model the existing operator bypass: the new upload path must NEVER use it.
  const owns = vi.fn((who: ApiPolicyActor, _kind: string, id: string) => who.role === 'SUPER_ADMIN' || owners.get(id) === who.userKey)
  const store: ApiPolicyStore = { ownerKey, owns, ownedIds: () => new Set(['owned']), claim: async () => undefined, release: async () => undefined }
  const policy = createApiPolicy({ actorFromCookie: resolve, actorFromRequest: req => resolve(req.headers.cookie, req.headers.authorization),
    store, ensureWorkspace: async () => ({ id: 'fixture', path: '/fixture', title: 'fixture' }) })
  return { actor, headers, owners, resolve, store, ownerKey, owns, policy, revoke: () => { live = null } }
}
function upload(f: ReturnType<typeof fixture>, query = 'sessionId=owned&name=fixture.bin', contentType = 'application/octet-stream', path = 'session/uploadFileBinary') {
  let reads = 0
  const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(BYTES); controller.close() } }, { highWaterMark: 0 })
  const request = new Request(`http://fixture/api/${path}${query ? `?${query}` : ''}`, {
    method: 'POST', headers: { ...f.headers, 'content-type': contentType }, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  const clone = vi.spyOn(request, 'clone')
  return { request, clone, reads: () => reads }
}
async function expectRejected(f: ReturnType<typeof fixture>, input: ReturnType<typeof upload>, status: number) {
  const next = vi.fn(async () => Response.json({ shouldNotReceivePrivateBytes: true }))
  const response = await f.policy.wrapFetch(next)(input.request)
  expect(response.status).toBe(status)
  expect(next).not.toHaveBeenCalled()
  expect(input.clone).not.toHaveBeenCalled()
  expect(input.reads()).toBe(0)
  expect(input.request.bodyUsed).toBe(false)
  expect(f.owns).not.toHaveBeenCalled()
  return response
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('streaming session.uploadFileBinary boundary', () => {
  it.each(['mobile', 'api-token', 'session'] as const)('streams an owned %s upload unchanged, without probing JSON', async kind => {
    const f = fixture(kind)
    const input = upload(f, 'sessionId=owned', 'Application/Octet-Stream; fixture=1')
    const receipt = { ok: true, value: { receiptId: 'fixture', file: { attachmentId: 'file-fixture', name: 'fixture.bin', bytes: BYTES.length } } }
    const next = vi.fn(async (seen: Request) => {
      expect(seen).toBe(input.request)
      expect(seen.bodyUsed).toBe(false)
      expect(new Uint8Array(await seen.arrayBuffer())).toEqual(BYTES)
      return Response.json(receipt)
    })
    const response = await f.policy.wrapFetch(next)(input.request)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expect(next).toHaveBeenCalledTimes(1)
    expect(input.clone).not.toHaveBeenCalled()
    expect(input.reads()).toBe(1)
    expect(f.ownerKey).toHaveBeenCalledTimes(2)
    expect(f.owns).not.toHaveBeenCalled()
  })

  it.each([
    ['mobile', 'STUDENT'], ['mobile', 'SUPER_ADMIN'], ['api-token', 'STUDENT'], ['api-token', 'SUPER_ADMIN'],
  ] as const)('denies read-only %s / %s before ownership probing or byte reads', async (kind, role) => {
    const f = fixture(kind, 'read', role)
    const result = await expectRejected(f, upload(f), 403)
    expect(await result.json()).toMatchObject({ error: { code: 'TOKEN_SCOPE_REQUIRED' } })
    expect(f.ownerKey).not.toHaveBeenCalled()
  })

  it.each(['mobile', 'api-token', 'session'] as const)('never lets a %s SUPER_ADMIN upload into a foreign session', async kind => {
    const f = fixture(kind, 'write', 'SUPER_ADMIN')
    await expectRejected(f, upload(f, 'sessionId=foreign'), 404)
  })

  it.each([
    '', 'name=fixture.bin', 'sessionId=', 'sessionId=%20', 'sessionId=%00',
    'sessionId=owned&sessionId=foreign', 'sessionId=owned&sessionId=owned', 'sessionId=owned&session%49d=owned',
  ])('rejects missing, empty, control or repeated identity query %s before byte reads', async query => {
    const f = fixture()
    await expectRejected(f, upload(f, query), 400)
    expect(f.ownerKey).not.toHaveBeenCalled()
  })

  it('does not distinguish an unknown resource from a foreign resource', async () => {
    const f = fixture()
    const foreign = await expectRejected(f, upload(f, 'sessionId=foreign'), 404)
    const absent = await expectRejected(f, upload(f, 'sessionId=absent'), 404)
    expect(await absent.json()).toEqual(await foreign.json())
  })

  it('refuses absent or failing exact-ledger capabilities instead of using admin owns()', async () => {
    const f = fixture('mobile', 'write', 'SUPER_ADMIN')
    delete f.store.ownerKey
    await expectRejected(f, upload(f), 503)
    f.store.ownerKey = () => { throw new Error('private backend details') }
    const failed = await expectRejected(f, upload(f), 503)
    expect(await failed.text()).not.toContain('private backend details')
  })

  it.each(['mobile', 'api-token'] as const)('refuses an expired/revoked %s credential before reading bytes', async kind => {
    const f = fixture(kind)
    f.revoke()
    const result = await expectRejected(f, upload(f), 401)
    expect(await result.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  it('rechecks a token invalidated between initial authentication and dispatch', async () => {
    const f = fixture()
    f.resolve.mockImplementationOnce(() => { f.revoke(); return f.actor })
    await expectRejected(f, upload(f), 401)
  })

  it('checks identity and write scope even when the caller disguises the body as JSON', async () => {
    const f = fixture('mobile', 'write', 'SUPER_ADMIN')
    await expectRejected(f, upload(f, 'sessionId=foreign', 'application/json'), 404)
    await expectRejected(f, upload(f, 'sessionId=owned', 'application/json'), 415)
    const readonly = fixture('api-token', 'read', 'SUPER_ADMIN')
    await expectRejected(readonly, upload(readonly, 'sessionId=foreign', 'application/json'), 403)
  })

  it('preserves the Web same-origin gate for cookie uploads', async () => {
    const f = fixture('session')
    const input = upload(f)
    input.request.headers.set('host', 'fixture')
    input.request.headers.set('origin', 'https://foreign.example')
    input.request.headers.set('sec-fetch-site', 'cross-site')
    await expectRejected(f, input, 403)
  })

  it.each(['another/stream', 'session.uploadFileBinary', 'session/uploadFileBinary/'])('does not grant a raw-body exemption to %s', async path => {
    const f = fixture('mobile', 'write', 'SUPER_ADMIN')
    await expectRejected(f, upload(f, 'sessionId=owned', 'application/octet-stream', path), 415)
  })

  it.each(['not-json', '{}'])('does not dispatch malformed/non-envelope JSON %s as an unchecked RPC', async body => {
    const f = fixture('mobile', 'write', 'SUPER_ADMIN')
    const next = vi.fn(async () => Response.json({ shouldNotRun: true }))
    const request = new Request('http://fixture/api/session/inbox/append', {
      method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body,
    })
    expect((await f.policy.wrapFetch(next)(request)).status).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['credential', 'owner'] as const)('drains the complete upload and rejects a %s change before publishing its receipt', async change => {
    const f = fixture()
    const input = upload(f)
    const entered = deferred()
    const finish = deferred()
    const pending = f.policy.wrapFetch(async seen => {
      expect(new Uint8Array(await seen.arrayBuffer())).toEqual(BYTES)
      entered.resolve()
      await finish.promise
      return Response.json({ privateReceipt: 'must-not-be-published' })
    })(input.request)
    await entered.promise
    let drained = false
    const draining = f.policy.drainAccountRequests(OWNER).then(() => { drained = true })
    await f.policy.drainAccountRequests('school:unrelated')
    expect(drained).toBe(false)
    if (change === 'credential') f.revoke()
    else f.owners.set('owned', 'school:replacement-owner')
    finish.resolve()
    const response = await pending
    expect(response.status).toBe(change === 'credential' ? 401 : 404)
    expect(await response.text()).not.toContain('must-not-be-published')
    await draining
    expect(drained).toBe(true)
    expect(input.clone).not.toHaveBeenCalled()
  })
})
