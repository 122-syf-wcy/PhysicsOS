// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminNoticeTab } from '../src/client/AdminNoticeTab.tsx'
import type { AnnouncementRow, FeedbackRow, NoticeApi } from '../src/client/notice-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: 'fb-1',
  schoolId: 'GZU',
  authorKey: 'GZU:s1',
  kind: 'bug',
  body: '液体压强实验里拖动液面读数不动',
  status: 'open',
  createdAt: '2026-09-23T02:00:00Z',
  ...over,
})

const announcement = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'an-1',
  schoolId: 'GZU',
  title: '开学通知',
  body: '本周一起',
  authorKey: 'GZU:a1',
  publishedAt: '2026-09-24T02:00:00Z',
  createdAt: '2026-09-24T02:00:00Z',
  ...over,
})

const stubApi = (items: readonly FeedbackRow[], announcements: readonly AnnouncementRow[] = []) => {
  const replyFeedback = vi.fn().mockResolvedValue({ item: row({ status: 'answered' }) })
  const publishAnnouncement = vi.fn().mockResolvedValue({ item: announcement() })
  const retireAnnouncement = vi.fn().mockResolvedValue({ item: announcement({ retiredAt: 'x' }) })
  const api = {
    listFeedback: vi.fn().mockResolvedValue({ items }),
    listAnnouncements: vi.fn().mockResolvedValue({ items: announcements }),
    replyFeedback,
    publishAnnouncement,
    retireAnnouncement,
  } as unknown as NoticeApi
  return { api, replyFeedback, publishAnnouncement, retireAnnouncement }
}

const mount = (api: NoticeApi, canPublish = true) =>
  render(<AdminNoticeTab api={api} canPublish={canPublish} t={t} />)

const statOf = (bucket: string): string | undefined =>
  document.querySelector(`[data-stat="${bucket}"] strong`)?.textContent ?? undefined

describe('AdminNoticeTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('counts the whole queue, not the filtered view', async () => {
    const { api } = stubApi([
      row({ id: 'a', status: 'open' }),
      row({ id: 'b', status: 'answered' }),
      row({ id: 'c', status: 'open' }),
      row({ id: 'd', status: 'closed' }),
    ])
    mount(api)
    await waitFor(() => { expect(statOf('feedback.open')).toBe('2') })

    expect(statOf('feedback.open')).toBe('2')
    expect(statOf('feedback.answered')).toBe('1')
    expect(statOf('feedback.closed')).toBe('1')
  })

  it('defaults to the open queue and narrows on request', async () => {
    const { api } = stubApi([
      row({ id: 'a', body: '还没处理的', status: 'open' }),
      row({ id: 'b', body: '已经回复的', status: 'answered' }),
    ])
    mount(api)
    expect(await screen.findByText('还没处理的')).toBeTruthy()
    expect(screen.queryByText('已经回复的')).toBeNull()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'answered' } })
    expect(await screen.findByText('已经回复的')).toBeTruthy()
    expect(screen.queryByText('还没处理的')).toBeNull()
  })

  it('replies to a report and refuses an empty reply', async () => {
    const { api, replyFeedback } = stubApi([row({ id: 'fb-9' })])
    mount(api)
    await screen.findByText('液体压强实验里拖动液面读数不动')

    const box = screen.getByPlaceholderText('回复这位同学')
    const button = screen.getByRole('button', { name: '回复' })
    expect(button.disabled).toBe(true)

    /* Whitespace is not a reply. */
    fireEvent.change(box, { target: { value: '   ' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(box, { target: { value: '已修复' } })
    fireEvent.click(button)
    await waitFor(() => { expect(replyFeedback).toHaveBeenCalledWith('fb-9', '已修复') })
  })

  it('publishes a notice and requires both fields', async () => {
    const { api, publishAnnouncement } = stubApi([])
    mount(api)
    await waitFor(() => { expect(screen.getByText('发布公告')).toBeTruthy() })

    const title = screen.getByPlaceholderText('公告标题')
    const body = screen.getByTestId('notice-body')
    const button = screen.getByRole('button', { name: '发布' })
    expect(button.disabled).toBe(true)

    fireEvent.change(title, { target: { value: '维护通知' } })
    expect(button.disabled).toBe(true)
    fireEvent.change(body, { target: { value: '今晚 22:00 起维护' } })
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    await waitFor(() => {
      expect(publishAnnouncement).toHaveBeenCalledWith({ title: '维护通知', body: '今晚 22:00 起维护' })
    })
  })

  it('does not offer publishing to a non-admin, and says why', async () => {
    /* A TEACHER reaches this tab through the console and may reply, but the
       host would refuse a publish — so the control is off and the reason is
       on screen rather than a button that fails. */
    const { api, publishAnnouncement } = stubApi([])
    mount(api, false)
    await waitFor(() => { expect(screen.getByText(/只有校管理员及以上角色可以发布公告/)).toBeTruthy() })

    const button = screen.getByRole('button', { name: '发布' })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('公告标题'), { target: { value: 'x' } })
    fireEvent.change(screen.getByTestId('notice-body'), { target: { value: 'y' } })
    fireEvent.click(button)
    expect(publishAnnouncement).not.toHaveBeenCalled()
  })

  it('retires a published notice', async () => {
    const { api, retireAnnouncement } = stubApi([], [announcement({ id: 'an-7' })])
    mount(api)
    await screen.findByText('开学通知')

    fireEvent.click(screen.getByRole('button', { name: '撤回' }))
    await waitFor(() => { expect(retireAnnouncement).toHaveBeenCalledWith('an-7') })
  })
})
