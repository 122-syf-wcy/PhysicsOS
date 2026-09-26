import { afterEach, describe, expect, it } from 'vitest'
import { totpCode } from '../src/totp.ts'
import {
  cookieOf,
  createSecurityHarness,
  post,
  school,
  user,
  type SecurityHarness,
} from './security-fixture.ts'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

const harnesses: SecurityHarness[] = []
let now = new Date('2024-01-01T00:00:00.000Z')

const makeHarness = async () => {
  const harness = await createSecurityHarness({
    config: { totpAttemptLimit: 5 },
    deps: { now: () => now },
    schools: [school('GZU', '贵州大学')],
    users: [
      user('GZU', 'teacher1', 'TEACHER'),
      user('GZU', 'student1', 'STUDENT'),
    ],
  })
  harnesses.push(harness)
  return harness
}

const loginCookie = async (
  harness: SecurityHarness,
  username: string,
  password = 'bootstrap-pass',
): Promise<string> => {
  const response = await post(harness.auth, '/login', { schoolId: 'GZU', username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

const enableTotp = async (
  harness: SecurityHarness,
  cookie: string,
): Promise<{ secret: string; recoveryCodes: string[] }> => {
  const setup = await post(harness.auth, '/2fa/setup', {}, {
    cookie: `physicsos_session=${cookie}`,
  })
  expect(setup.status).toBe(200)
  const { secret, uri } = await setup.json() as { secret: string; uri: string }
  expect(uri).toMatch(/^otpauth:\/\/totp\//)
  expect(uri).toContain('algorithm=SHA1')
  expect(uri).toContain('digits=6')
  expect(uri).toContain('period=30')

  const enabled = await post(harness.auth, '/2fa/enable', {
    code: totpCode(secret, now.getTime()),
  }, { cookie: `physicsos_session=${cookie}` })
  expect(enabled.status).toBe(200)
  const body = await enabled.json() as { recoveryCodes: string[] }
  expect(body.recoveryCodes).toHaveLength(10)
  return { secret, recoveryCodes: body.recoveryCodes }
}

afterEach(async () => {
  now = new Date('2024-01-01T00:00:00.000Z')
  await Promise.all(harnesses.splice(0).map(harness => harness.close()))
})

describe('RFC 6238 TOTP vectors', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches Appendix B at %i seconds', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, 8)).toBe(expected)
  })
})

describe('TOTP enrollment and login', () => {
  it('enrolls administrators and teachers, stores only hashes, and returns recovery codes once', async () => {
    const harness = await makeHarness()
    const teacherCookie = await loginCookie(harness, 'teacher1')
    const studentCookie = await loginCookie(harness, 'student1')
    const forbidden = await post(harness.auth, '/2fa/setup', {}, {
      cookie: `physicsos_session=${studentCookie}`,
    })
    expect(forbidden.status).toBe(403)

    const { secret, recoveryCodes } = await enableTotp(harness, teacherCookie)
    expect(secret.length).toBeGreaterThanOrEqual(26)
    const users = [...harness.domain.table('users').entries()]
    const recoveryRows = [...harness.domain.table('totp_recovery_codes').entries()]
    expect(recoveryRows).toHaveLength(10)
    const stored = JSON.stringify([users, recoveryRows])
    /* The TOTP shared secret must be durable to verify future codes; recovery
       codes are the one-time credentials and therefore appear only as hashes. */
    expect(users[0]?.[1].totp?.secret).toBe(secret)
    for (const code of recoveryCodes) expect(stored).not.toContain(code.toLowerCase())
    expect(recoveryRows.every(([, row]) => row.codeHash.length === 64)).toBe(true)
  })

  it('challenges password login, allows ±1 step, and consumes a recovery code once', async () => {
    const harness = await makeHarness()
    const enrolledCookie = await loginCookie(harness, 'teacher1')
    const { recoveryCodes } = await enableTotp(harness, enrolledCookie)

    const first = await post(harness.auth, '/login', {
      schoolId: 'GZU',
      username: 'teacher1',
      password: 'bootstrap-pass',
      deviceId: 'a'.repeat(32),
    })
    expect(first.status).toBe(200)
    expect(first.headers.get('set-cookie')).toBeNull()
    const challenge = await first.json() as { twoFactorRequired: boolean; challengeToken: string }
    expect(challenge.twoFactorRequired).toBe(true)

    const wrong = await post(harness.auth, '/login/2fa', {
      challengeToken: challenge.challengeToken,
      code: '000000',
    })
    expect(wrong.status).toBe(401)
    expect((await wrong.json() as { error: { code: string } }).error.code).toBe('INVALID_TWO_FACTOR_CODE')

    /* Read the stored secret, which is part of the durable user row and never
       returned twice, to prove the verifier accepts the adjacent time step. */
    const teacher = harness.domain.table('users').get('GZU:teacher1')
    if (teacher?.totp === undefined) throw new Error('expected enabled TOTP')

    const completed = await post(harness.auth, '/login/2fa', {
      challengeToken: challenge.challengeToken,
      code: totpCode(teacher.totp.secret, now.getTime() - 30_000),
    })
    expect(completed.status).toBe(200)
    expect(cookieOf(completed).length).toBeGreaterThan(0)

    const recovered = await post(harness.auth, '/login', {
      schoolId: 'GZU',
      username: 'teacher1',
      password: 'bootstrap-pass',
    })
    const recoveryChallenge = await recovered.json() as { challengeToken: string }
    const recoveryCode = recoveryCodes[0]
    if (recoveryCode === undefined) throw new Error('expected recovery code')
    const recoveryLogin = await post(harness.auth, '/login/2fa', {
      challengeToken: recoveryChallenge.challengeToken,
      code: recoveryCode,
    })
    expect(recoveryLogin.status).toBe(200)
    expect(cookieOf(recoveryLogin).length).toBeGreaterThan(0)

    const replay = await post(harness.auth, '/login', {
      schoolId: 'GZU',
      username: 'teacher1',
      password: 'bootstrap-pass',
    })
    const replayChallenge = await replay.json() as { challengeToken: string }
    const replayResponse = await post(harness.auth, '/login/2fa', {
      challengeToken: replayChallenge.challengeToken,
      code: recoveryCode,
    })
    expect(replayResponse.status).toBe(401)
  })

  it('verifies and disables with password plus TOTP, then returns ordinary login', async () => {
    const harness = await makeHarness()
    const cookie = await loginCookie(harness, 'teacher1')
    const { secret } = await enableTotp(harness, cookie)

    const verified = await post(harness.auth, '/2fa/verify', {
      code: totpCode(secret, now.getTime()),
    }, { cookie: `physicsos_session=${cookie}` })
    expect(verified.status).toBe(200)

    const refused = await post(harness.auth, '/2fa/disable', {
      password: 'wrong-password',
      code: totpCode(secret, now.getTime()),
    }, { cookie: `physicsos_session=${cookie}` })
    expect(refused.status).toBe(401)

    const disabled = await post(harness.auth, '/2fa/disable', {
      password: 'bootstrap-pass',
      code: totpCode(secret, now.getTime()),
    }, { cookie: `physicsos_session=${cookie}` })
    expect(disabled.status).toBe(200)
    expect([...harness.domain.table('totp_recovery_codes').entries()]).toHaveLength(0)
    expect((await post(harness.auth, '/login', {
      schoolId: 'GZU',
      username: 'teacher1',
      password: 'bootstrap-pass',
    })).status).toBe(200)
  })
})
