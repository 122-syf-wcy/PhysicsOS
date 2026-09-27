// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminNoticeTab } from '../src/client/AdminNoticeTab.tsx'
import type { FeedbackRow, NoticeApi } from '../src/client/notice-api.ts'
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

const stubApi = (items: readonly FeedbackRow[]) => {
  const replyFeedback = vi.fn().mockResolvedValue({ item: row({ status: 'answered' }) })
  const api = {
    listFeedback: vi.fn().mockResolvedValue({ items }),
    replyFeedback,
  } as unknown as NoticeApi
  return { api, replyFeedback }
}

const mount = (api: NoticeApi) =>
  render(<AdminNoticeTab api={api} t={t} />)

const statOf = (bucket: string): string | undefined =>
  document.querySelector(`[data-stat="${bucket}"] strong`)?.textContent ?? undefined

describe('AdminNoticeTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('keeps one feedback-only queue and counts the whole collection', async () => {
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
    expect(screen.queryByText('发布公告')).toBeNull()
  })

  it('defaults to the open queue and narrows on request', async () => {
    const { api } = stubApi([
      row({ id: 'a', body: '还没处理的', status: 'open' }),
      row({ id: 'b', body: '已经回复的', status: 'answered' }),
    ])
    mount(api)
    expect(await screen.findByText('还没处理的')).toBeTruthy()
    expect(screen.queryByText('已经回复的')).toBeNull()

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: '已回复' }))
    expect(await screen.findByText('已经回复的')).toBeTruthy()
    expect(screen.queryByText('还没处理的')).toBeNull()
  })

  it('replies to a report and refuses an empty reply', async () => {
    const { api, replyFeedback } = stubApi([row({ id: 'fb-9' })])
    mount(api)
    await screen.findByText('液体压强实验里拖动液面读数不动')

    const box = screen.getByPlaceholderText('回复这位同学')
    const button = screen.getByRole('button', { name: '回复' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(box, { target: { value: '   ' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(box, { target: { value: '已修复' } })
    fireEvent.click(button)
    await waitFor(() => { expect(replyFeedback).toHaveBeenCalledWith('fb-9', '已修复') })
  })
})
