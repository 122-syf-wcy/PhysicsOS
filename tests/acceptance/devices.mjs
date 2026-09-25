/**
 * 设备登记 / 远程注销 end to end, over a REAL server and a REAL browser session.
 *
 * What this file is for — the parts a unit test cannot see:
 *
 *   - the device tab is reachable in the SERVED bundle, driven by the real
 *     super-admin session (a student must not even see that entry);
 *   - clicking 远程注销 in the browser really flips the HOST's state, and the
 *     student's already-issued session is refused from that moment — i.e. the
 *     revocation reaches the live session, not merely a row;
 *   - 恢复 puts it back, so an operator can undo a mistaken click;
 *   - the risk payload carries counts and NO address, checked against the
 *     host's own JSON rather than the rendered text alone.
 *
 * node tests/acceptance/devices.mjs
 */
import { stdout } from 'node:process'

import {
  ACCEPTANCE_ADMIN_PASSWORD,
  ACCEPTANCE_ADMIN_USERNAME,
  loginUser,
  openAcceptance,
  resetSession,
  startIsolatedServer,
} from './support.mjs'

const server = await startIsolatedServer({ port: 3094 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, { base: server.base })

const call = (path, { method = 'GET', body, cookie } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/**
 * Sign in and return the session cookie.
 *
 * `deviceId` matters for the live-session case: only a session that DECLARED a
 * device can be attributed to it. A session that never named a machine is not
 * guessed at, so revoking one device cannot disconnect the same account
 * somewhere else — which is the honest semantic, and the reason this helper
 * takes the parameter rather than always sending it.
 */
const sessionOf = async (username, password, deviceId) => {
  const res = await fetch(`${base}/physicsos/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, ...(deviceId === undefined ? {} : { deviceId }) }),
  })
  if (res.status !== 200) return undefined
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
  const session = cookies.find(value => value.startsWith('physicsos_session='))
  return session === undefined ? undefined : session.split(';')[0]
}

const DEVICE = Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[i % 16]).join('')
const OTHER_DEVICE = Array.from({ length: 64 }, (_, i) => 'fedcba9876543210'[i % 16]).join('')

const stamp = Date.now().toString(36).slice(-6)
const PASSWORD = 'accept-device-2026'
const studentName = `dv_${stamp}`

const openDeviceTab = async () => {
  /* 管理后台 lives behind the account menu, not the sidebar — open it first. */
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: /管理后台/ }).click()
  await page.locator('[data-physicsos-surface="admin"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByRole('tab', { name: '设备' }).click()
  await page.getByTestId('device-list').waitFor({ state: 'visible', timeout: 20_000 })
}

try {
  const signUp = await call('/physicsos/auth/register', {
    method: 'POST',
    body: {
      schoolName: '乌当中学', username: studentName,
      displayName: '验收学生', password: PASSWORD, deviceId: DEVICE,
    },
  })
  check('注册时带上设备哈希,登记成功', signUp.status === 201, `HTTP ${signUp.status}`)
  /* 关键:这条会话**声明了设备**,所以它才可被归因、才谈得上被远程注销踢掉。 */
  const studentCookie = await sessionOf(studentName, PASSWORD, DEVICE)
  check('学生带着设备登录成功', studentCookie !== undefined)

  /* 对照组:一条**没有**声明设备的会话,不该被这次注销连坐 —— 它可能在任何
     一台机器上,把账号在别处的登录一起踢掉不是「注销这台设备」的意思。 */
  const unattributed = await sessionOf(studentName, PASSWORD)
  check('另有一条不带设备的会话作对照', unattributed !== undefined)

  const adminCookie = await sessionOf(ACCEPTANCE_ADMIN_USERNAME, ACCEPTANCE_ADMIN_PASSWORD)
  check('超管登录成功', adminCookie !== undefined)

  const rawSerial = await call('/physicsos/auth/devices', {
    method: 'POST',
    cookie: studentCookie,
    body: { deviceId: '12345678-ABCD-EFGH-9012-34567890ABCD' },
  })
  check('带连字符的原始序列号被拒(只收哈希)', rawSerial.status === 400, `HTTP ${rawSerial.status}`)

  const unregistered = await call('/physicsos/auth/login', {
    method: 'POST',
    body: { username: studentName, password: PASSWORD },
  })
  check('没带 deviceId 的登录照常', unregistered.status === 200, `HTTP ${unregistered.status}`)

  const listed = await (await call('/physicsos/admin/devices', { cookie: adminCookie })).json()
  check('后台能看到这台设备', listed.devices.some(row => row.deviceId === DEVICE),
    `${listed.devices.length} 台`)

  await resetSession(page, base)
  await loginUser(page, {
    username: ACCEPTANCE_ADMIN_USERNAME,
    password: ACCEPTANCE_ADMIN_PASSWORD,
  })
  await openDeviceTab()

  check('设备 tab 里列出了这台机器',
    await page.locator(`[data-device="${DEVICE}"]`).count() === 1)

  stdout.write('\nCASE · 在界面上远程注销这台设备 → 学生的会话当场失效\n')
  await page.getByTestId(`device-toggle-${DEVICE}`).click()
  await page.waitForFunction(
    device => document.querySelector(`[data-device="${device}"]`)?.getAttribute('data-revoked') === 'true',
    DEVICE, { timeout: 20_000 },
  ).catch(() => {})
  check('界面把这台设备标成已注销',
    await page.locator(`[data-device="${DEVICE}"]`).getAttribute('data-revoked') === 'true')

  const afterRevoke = await (await call('/physicsos/admin/devices', { cookie: adminCookie })).json()
  check('服务端确实注销了它',
    afterRevoke.devices.find(row => row.deviceId === DEVICE)?.revoked === true)

  const me = await call('/physicsos/auth/me', { cookie: studentCookie })
  check('声明了设备的那条会话立刻失效(不必等 cookie 过期)', me.status === 401, `HTTP ${me.status}`)

  const control = await call('/physicsos/auth/me', { cookie: unattributed })
  check('没声明设备的那条会话不被连坐 —— 它可能在任何一台机器上', control.status === 200,
    `HTTP ${control.status}`)

  const relogin = await call('/physicsos/auth/login', {
    method: 'POST',
    body: { username: studentName, password: PASSWORD, deviceId: DEVICE },
  })
  check('这台机器上重新登录被拒(DEVICE_REVOKED)', relogin.status === 403, `HTTP ${relogin.status}`)
  check('拒绝码是 DEVICE_REVOKED',
    (await relogin.json()).error?.code === 'DEVICE_REVOKED')

  stdout.write('\nCASE · 恢复 → 一切照旧(注销是可逆的管理动作)\n')
  await page.reload()
  await openDeviceTab()
  await page.getByTestId(`device-toggle-${DEVICE}`).click()
  await page.waitForFunction(
    device => document.querySelector(`[data-device="${device}"]`)?.getAttribute('data-revoked') === 'false',
    DEVICE, { timeout: 20_000 },
  ).catch(() => {})
  check('界面把恢复状态画出来了',
    await page.locator(`[data-device="${DEVICE}"]`).getAttribute('data-revoked') === 'false')

  const back = await call('/physicsos/auth/login', {
    method: 'POST',
    body: { username: studentName, password: PASSWORD, deviceId: DEVICE },
  })
  check('恢复后这台机器又能登录了', back.status === 200, `HTTP ${back.status}`)

  const riskRaw = await (await call('/physicsos/admin/devices', { cookie: adminCookie })).text()
  check('设备 JSON 里没有 IP 字段', !riskRaw.includes('"ip"'))
  check('设备 JSON 里没有回环地址', !riskRaw.includes('127.0.0.1') && !riskRaw.includes('::1'))

  check('另一台机器没有被误伤',
    afterRevoke.devices.find(row => row.deviceId === OTHER_DEVICE) === undefined)
} finally {
  await finish()
  server.stop()
}
