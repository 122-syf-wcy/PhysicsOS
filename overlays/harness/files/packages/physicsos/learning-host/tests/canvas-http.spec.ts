import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { canvasActor, canvasResponseActor } from '../src/canvas-http.ts'
import type { IdentityActor, PhysicsosIdentity } from '../src/identity.ts'

const actorA: IdentityActor = { schoolId: 'SCHOOL', userKey: 'SCHOOL:alice', username: 'alice', role: 'STUDENT' }
const actorB: IdentityActor = { schoolId: 'SCHOOL', userKey: 'SCHOOL:bob', username: 'bob', role: 'SUPER_ADMIN' }
const identity = (actor: () => IdentityActor | null): PhysicsosIdentity => ({ actorOf: actor, record: async () => {} })
const request = (owner?: string): IncomingMessage => {
  const req = new IncomingMessage(new Socket())
  if (owner !== undefined) req.headers['x-physicsos-canvas-owner'] = owner
  return req
}

describe('Canvas expected-account rejection precondition', () => {
  it('uses only actual cookie authority and rechecks a changed actor before exposing a response', () => {
    let current = actorA
    const service = identity(() => current)
    const req = request(encodeURIComponent(canonicalStringify({ schoolId: actorA.schoolId, username: actorA.username })))
    const admitted = canvasActor(service, req)
    expect(admitted).toBe(actorA)
    current = actorB
    expect(() => canvasResponseActor(service, req, admitted)).toThrow(expect.objectContaining({ status: 401, code: 'ACCOUNT_CHANGED' }))
  })

  it('rechecks identity changes even when an internal caller omitted the optional expectation header', () => {
    let current = actorA
    const service = identity(() => current)
    const req = request()
    const admitted = canvasActor(service, req)
    current = actorB
    expect(() => canvasResponseActor(service, req, admitted)).toThrow(expect.objectContaining({ code: 'ACCOUNT_CHANGED' }))
  })

  it('does not turn a correct expectation into authentication', () => {
    const req = request(encodeURIComponent(canonicalStringify({ schoolId: actorA.schoolId, username: actorA.username })))
    expect(() => canvasActor(identity(() => null), req)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }))
    expect(() => canvasActor(undefined, req)).toThrow(expect.objectContaining({ code: 'IDENTITY_UNAVAILABLE' }))
  })

  it('refuses duplicated account headers rather than choosing one principal', () => {
    const owner = encodeURIComponent(canonicalStringify({ schoolId: actorA.schoolId, username: actorA.username }))
    const req = request(owner)
    req.rawHeaders = ['X-Physicsos-Canvas-Owner', owner, 'x-physicsos-canvas-owner', owner]
    expect(() => canvasActor(identity(() => actorA), req)).toThrow(expect.objectContaining({ code: 'BAD_ACCOUNT_HEADER' }))
  })

  it('refuses malformed or authorization-bearing account headers', () => {
    for (const owner of ['%zz', encodeURIComponent('{}'), encodeURIComponent(canonicalStringify({ schoolId: actorA.schoolId, username: actorA.username, role: 'SUPER_ADMIN' }))]) {
      expect(() => canvasActor(identity(() => actorA), request(owner))).toThrow(expect.objectContaining({ status: 400, code: 'BAD_ACCOUNT_HEADER' }))
    }
  })
})
