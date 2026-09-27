// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminPlatformNoticeTab } from '../src/client/AdminPlatformNoticeTab.tsx'
import type { NoticeApi, PlatformNoticeRow } from '../src/client/notice-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const row = (over: Partial<PlatformNoticeRow> = {}): PlatformNoticeRow => ({
  title: 'PhysicsOS 公测声明',
  body: '## 公测说明\n\n- **数据**仅用于教学改进。',
  version: 7,
  enabled: true,
  updatedAt: '2026-09-26T12:30:00Z',
  updatedBy: 'PHYSICSOS-OPEN:admin',
  ...over,
})

const mount = () => {
  const getPlatformNotice = vi.fn().mockResolvedValue({
    notice: row(),
    acknowledgedVersion: null,
  })
  const updatePlatformNotice = vi.fn().mockResolvedValue({
    notice: row({ title: '新学期公测说明', body: '新正文', enabled: false, version: 8 }),
  })
  const api = { getPlatformNotice, updatePlatformNotice } as unknown as NoticeApi
  render(<AdminPlatformNoticeTab api={api} t={t} />)
  return { getPlatformNotice, updatePlatformNotice }
}

describe('AdminPlatformNoticeTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('loads the current version and saves an edit as the next version', async () => {
    const { updatePlatformNotice } = mount()
    expect(await screen.findByDisplayValue('PhysicsOS 公测声明')).toBeTruthy()
    expect(screen.getByText(/当前版本 7/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('公告标题'), {
      target: { value: '新学期公测说明' },
    })
    fireEvent.change(screen.getByLabelText('公告正文（Markdown）'), {
      target: { value: '新正文' },
    })
    fireEvent.click(screen.getByLabelText('下次进入时展示这份公告'))
    fireEvent.click(screen.getByRole('button', { name: '保存并发布新版本' }))

    await waitFor(() => {
      expect(updatePlatformNotice).toHaveBeenCalledWith({
        title: '新学期公测说明',
        body: '新正文',
        enabled: false,
      })
    })
    expect(await screen.findByText(/当前版本 8/)).toBeTruthy()
  })

  it('renders a live Markdown preview before saving', async () => {
    mount()
    await screen.findByRole('heading', { level: 2, name: '公测说明' })
    expect(screen.getByText('数据').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('公告正文（Markdown）'), {
      target: { value: '### 维护通知\n\n> 今晚 22:00 起维护' },
    })
    expect(await screen.findByRole('heading', { level: 3, name: '维护通知' })).toBeTruthy()
    expect(screen.getByText('今晚 22:00 起维护')).toBeTruthy()
  })

  it('refuses an empty title or oversized body before the request', async () => {
    const { updatePlatformNotice } = mount()
    await screen.findByDisplayValue('PhysicsOS 公测声明')

    const title = screen.getByLabelText('公告标题')
    const button = screen.getByRole('button', { name: '保存并发布新版本' }) as HTMLButtonElement
    fireEvent.change(title, { target: { value: '   ' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(title, { target: { value: '有效标题' } })
    fireEvent.change(screen.getByLabelText('公告正文（Markdown）'), {
      target: { value: 'x'.repeat(2001) },
    })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(updatePlatformNotice).not.toHaveBeenCalled()
  })
})
