import { afterEach, describe, expect, it } from 'vitest'
import {
  cookieOf,
  createSecurityHarness,
  post,
  school,
  user,
  type SecurityHarness,
} from './security-fixture.ts'

const harnesses: SecurityHarness[] = []

const makeHarness = async (): Promise<SecurityHarness> => {
  const harness = await createSecurityHarness({
    schools: [
      school('GZU', '贵州大学'),
      school('PHYSICSOS-OPEN', 'PhysicsOS 平台'),
    ],
    users: [
      user('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN'),
      user('GZU', 'student1', 'STUDENT'),
    ],
  })
  harnesses.push(harness)
  return harness
}

const adminCookie = async (harness: SecurityHarness): Promise<string> => {
  const response = await post(harness.auth, '/login', {
    schoolId: 'PHYSICSOS-OPEN',
    username: 'admin',
    password: 'bootstrap-pass',
  })
  return cookieOf(response)
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.close()))
})

describe('new-login audit signals', () => {
  it('records first device and first IP, then suppresses duplicates', async () => {
    const harness = await makeHarness()
    await harness.service.login({
      schoolId: 'GZU',
      username: 'student1',
      password: 'bootstrap-pass',
      deviceId: 'a'.repeat(32),
    }, '192.0.2.10', 'test-agent')
    await harness.service.login({
      schoolId: 'GZU',
      username: 'student1',
      password: 'bootstrap-pass',
      deviceId: 'a'.repeat(32),
    }, '192.0.2.10', 'test-agent')
    await harness.service.login({
      schoolId: 'GZU',
      username: 'student1',
      password: 'bootstrap-pass',
      deviceId: 'a'.repeat(32),
    }, '192.0.2.11', 'test-agent')

    const events = [...harness.domain.table('admin_audit').entries()]
      .map(([, row]) => row)
      .filter(row => row.action === 'auth.new_login')
    expect(events).toHaveLength(2)
    expect(events[0]?.detail).toMatchObject({
      newDevice: true,
      newIp: true,
      ip: '192.0.2.10',
      deviceId: 'a'.repeat(32),
    })
    expect(events[1]?.detail).toMatchObject({
      newDevice: false,
      newIp: true,
      ip: '192.0.2.11',
      deviceId: 'a'.repeat(32),
    })
  })
})

describe('streaming audit export', () => {
  it('exports CSV and JSONL with school/time filters and the requested row cap', async () => {
    const harness = await makeHarness()
    const cookie = await adminCookie(harness)
    const headers = { cookie: `physicsos_session=${cookie}` }
    const base = Date.parse('2026-01-01T00:00:00.000Z')

    for (let index = 0; index < 5; index += 1) {
      await harness.domain.table('admin_audit').put(`seed-${index}`, {
        id: `seed-${index}`,
        actorKey: 'GZU:student1',
        schoolId: index === 4 ? 'PHYSICSOS-OPEN' : 'GZU',
        action: index === 0 ? 'action,with,"quotes"' : `action-${index}`,
        target: `target-${index}`,
        detail: { index },
        createdAt: new Date(base + index * 1_000).toISOString(),
      })
    }

    const csv = await post(harness.admin, '/audit/export', {
      format: 'csv',
      schoolId: 'GZU',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T00:00:04.000Z',
      limit: 2,
    }, headers)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const csvBody = await csv.text()
    expect(csvBody.split('\n').filter(Boolean)).toHaveLength(3)
    expect(csvBody).toContain('"action,with,""quotes"""')
    expect(csvBody).not.toContain('target-3')

    const jsonl = await post(harness.admin, '/audit/export', {
      format: 'jsonl',
      schoolId: 'GZU',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T00:00:05.000Z',
      limit: 10,
    }, headers)
    expect(jsonl.status).toBe(200)
    expect(jsonl.headers.get('content-type')).toContain('application/x-ndjson')
    const lines = (await jsonl.text()).split('\n').filter(Boolean)
    const parsed = lines.map((line): { schoolId: string } =>
      JSON.parse(line) as { schoolId: string })
    expect(lines).toHaveLength(4)
    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: 'GZU' }),
    ]))
    expect(parsed.every(row => row.schoolId === 'GZU')).toBe(true)
  })

  it('validates format, range, and limit before writing any body', async () => {
    const harness = await makeHarness()
    const cookie = await adminCookie(harness)
    const headers = { cookie: `physicsos_session=${cookie}` }

    const reversed = await post(harness.admin, '/audit/export', {
      format: 'csv',
      from: '2026-01-02T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    }, headers)
    expect(reversed.status).toBe(400)
    const tooMany = await post(harness.admin, '/audit/export', {
      format: 'jsonl',
      limit: 50_001,
    }, headers)
    expect(tooMany.status).toBe(400)
    const badFormat = await post(harness.admin, '/audit/export', {
      format: 'xml',
    }, headers)
    expect(badFormat.status).toBe(400)

    const crossSite = await post(harness.admin, '/audit/export', {
      format: 'csv',
    }, { ...headers, origin: 'https://evil.example' })
    expect(crossSite.status).toBe(403)
    const wrongType = await fetch(`${harness.admin}/audit/export`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'text/plain' },
      body: '{}',
    })
    expect(wrongType.status).toBe(400)
  })
})
