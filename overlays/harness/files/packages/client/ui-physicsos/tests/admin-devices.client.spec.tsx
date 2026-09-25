// @vitest-environment jsdom
/**
 * 设备 tab 的客户端 spec。
 *
 * 这一屏的核心不是「表格能画出来」,而是三个**易被写错**的决定,每条各配一组
 * 断言:
 *
 *   - 注销按钮打的是**这台设备**,请求体里的 `revoked` 必须与当前状态相反
 *     (拿一台已注销的去点,发的就是 `revoked: false`)。
 *   - 平台级注销与校级注销在界面上**分得开** —— 校管理员才不会点了「恢复」却
 *     不知道为什么没生效。
 *   - 风控信号**没有 IP**:整个渲染出来的文本里搜不到地址,而且文案不能让用户
 *     以为这是自动封禁。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminDeviceTab } from '../src/client/AdminDeviceTab.tsx'
import type { AdminApi, DeviceRow, RiskSignalRow } from '../src/client/auth-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const HASH = 'a'.repeat(64)

const row = (over: Partial<DeviceRow> = {}): DeviceRow => ({
  id: `GZU:student1|${HASH}`,
  deviceId: HASH,
  primaryUserKey: 'GZU:student1',
  schoolId: 'GZU',
  username: 'student1',
  platform: 'macos',
  firstSeenAt: '2026-09-24T01:00:00.000Z',
  lastSeenAt: '2026-09-25T02:11:03.000Z',
  seenCount: 7,
  revoked: false,
  revokedGlobally: false,
  ...over,
})

/** Only the two calls this tab owns are stubbed. */
const stubApi = (
  devices: DeviceRow[], risk: RiskSignalRow[] = [],
) => {
  const listDevices = vi.fn().mockResolvedValue({ devices, risk })
  const setDeviceRevoked = vi.fn().mockResolvedValue({ deviceId: HASH, scope: '*' })
  const api = { listDevices, setDeviceRevoked } as unknown as AdminApi
  return { api, listDevices, setDeviceRevoked }
}

const mount = (api: AdminApi, isSuper = true) =>
  render(<AdminDeviceTab api={api} isSuper={isSuper} t={t} />)

afterEach(cleanup)

describe('设备 tab', () => {
  it('画出设备哈希与账号,哈希不是全长的序列号样貌', async () => {
    const { api } = stubApi([row()])
    mount(api)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    const cell = screen.getByTestId('device-list')
    expect(cell.textContent).toContain('student1')
    /* 展示的是短哈希,不是 64 个字符全铺开。 */
    expect(cell.textContent).not.toContain(HASH)
    expect(cell.textContent).toContain('a'.repeat(12))
  })

  it('点注销发的是「反向」的 revoked —— 已注销的点一下就是恢复', async () => {
    const active = stubApi([row()])
    mount(active.api)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    fireEvent.click(screen.getByTestId(`device-toggle-${HASH}`))
    await waitFor(() => { expect(active.setDeviceRevoked).toHaveBeenCalledWith(HASH, true) })
    cleanup()

    const revoked = stubApi([row({ revoked: true })])
    mount(revoked.api)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    fireEvent.click(screen.getByTestId(`device-toggle-${HASH}`))
    await waitFor(() => { expect(revoked.setDeviceRevoked).toHaveBeenCalledWith(HASH, false) })
  })

  it('平台级与校级注销在界面上分得开', async () => {
    const { api } = stubApi([
      row({ id: 'a', revoked: true, revokedGlobally: true }),
      row({ id: 'b', deviceId: 'b'.repeat(64), username: 'student2', revoked: true, revokedGlobally: false }),
    ])
    mount(api)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    const text = screen.getByTestId('device-list').textContent ?? ''
    expect(text).toContain(zh['admin.devices.state.global'])
    expect(text).toContain(zh['admin.devices.state.local'])
  })

  it('风控信号渲染成计数句,且整屏文本里没有 IP', async () => {
    const { api } = stubApi([row()], [
      { kind: 'account-multi-device', subject: 'GZU:student1', count: 5, windowMs: 86_400_000 },
      { kind: 'device-multi-ip', subject: HASH, count: 4, windowMs: 86_400_000 },
    ])
    const { container } = mount(api)
    await waitFor(() => { expect(screen.getByTestId('device-risk')).toBeTruthy() })
    const text = container.textContent ?? ''
    expect(text).toContain('5')
    expect(text).toContain('24')
    expect(text).not.toContain('127.0.0.1')
    expect(text).not.toContain('192.168')
    /* 文案必须说清「不自动封禁」与「没有 IP」——这两句是产品的隐私立场。 */
    expect(text).toContain(zh['admin.devices.risk.hint'])
  })

  it('设备列表为空时说清「登记是增项,不是门槛」,而不是画一张空表', async () => {
    const { api } = stubApi([])
    mount(api)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    expect(screen.getByTestId('device-list').textContent).toContain(zh['admin.devices.empty'])
  })

  it('校管理员看不到「学校」这一列 —— 那一列只在超管视图里有意义', async () => {
    const { api } = stubApi([row()])
    mount(api, false)
    await waitFor(() => { expect(screen.getByTestId('device-list')).toBeTruthy() })
    const heads = [...screen.getByTestId('device-list').querySelectorAll('th')]
      .map(th => th.textContent)
    expect(heads).not.toContain(zh['admin.devices.col.school'])
  })

  it('列表拉取失败时把原因说出来,不留一块空白', async () => {
    const api = {
      listDevices: vi.fn().mockRejectedValue(new Error('没有权限')),
      setDeviceRevoked: vi.fn(),
    } as unknown as AdminApi
    mount(api)
    await waitFor(() => { expect(screen.getByText('没有权限')).toBeTruthy() })
  })
})
