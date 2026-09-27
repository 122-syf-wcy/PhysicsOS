// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlatformNoticeDialog } from '../src/client/PlatformNoticeDialog.tsx'
import type { NoticeApi, PlatformNoticeRow } from '../src/client/notice-api.ts'
import type { AuthState } from '../src/client/auth-store.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const notice = (over: Partial<PlatformNoticeRow> = {}): PlatformNoticeRow => ({
  title: 'PhysicsOS 公测声明',
  body: '## 公测说明\n\n- **数据**仅用于教学改进。\n- 欢迎通过反馈提交问题。',
  version: 4,
  enabled: true,
  updatedAt: '2026-09-26T12:00:00Z',
  updatedBy: 'PHYSICSOS-OPEN:admin',
  ...over,
})

const authed = <T,>(selector: (state: AuthState) => T): T =>
  selector({
    status: 'authed',
    user: {
      id: 'u-1',
      schoolId: 'GZU',
      schoolName: '贵州大学附属中学',
      username: 'student',
      displayName: '学生甲',
      role: 'STUDENT',
    },
    error: undefined,
  } as AuthState)

const mount = (input: {
  readonly notice?: PlatformNoticeRow
  readonly acknowledgedVersion?: number | null
}) => {
  const getPlatformNotice = vi.fn().mockResolvedValue({
    notice: input.notice ?? notice(),
    acknowledgedVersion: input.acknowledgedVersion ?? null,
  })
  const ackPlatformNotice = vi.fn().mockResolvedValue({ acknowledgedVersion: 4 })
  const api = { getPlatformNotice, ackPlatformNotice } as unknown as NoticeApi
  render(<PlatformNoticeDialog api={api} useAuth={authed} useSessions={neverHook} useWorkspaces={neverHook} t={t as never} />)
  return { getPlatformNotice, ackPlatformNotice }
}

const neverHook = (() => { throw new Error('unused hook') }) as never

describe('PlatformNoticeDialog', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('blocks an authenticated account until the current notice version is acknowledged', async () => {
    const { ackPlatformNotice } = mount({})
    const dialog = await screen.findByRole('dialog', { name: 'PhysicsOS 公测声明' })
    expect(dialog.textContent).toContain('公测说明')
    expect(screen.getByRole('heading', { level: 2, name: '公测说明' })).toBeTruthy()
    expect(screen.getByText('数据').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => { expect(ackPlatformNotice).toHaveBeenCalledWith(4) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('does not render a disabled notice', async () => {
    mount({ notice: notice({ enabled: false }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('does not render when this account already acknowledged the current version', async () => {
    mount({ acknowledgedVersion: 4 })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('shows the new copy again after the platform version changes', async () => {
    mount({ acknowledgedVersion: 3 })
    expect(await screen.findByRole('dialog', { name: 'PhysicsOS 公测声明' })).toBeTruthy()
  })
})
