// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NoticeBoard } from '../src/client/NoticeBoard.tsx'
import type { AnnouncementRow, FeedbackRow, NoticeApi } from '../src/client/notice-api.ts'
import { readCachedAnnouncements, writeCachedAnnouncements } from '../src/client/notice-cache.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const notice = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'an-1',
  schoolId: null,
  title: '版本更新',
  body: '实验中心新增四台装置',
  authorKey: 'PHYSICSOS-OPEN:admin',
  publishedAt: '2026-09-24T02:00:00Z',
  createdAt: '2026-09-24T02:00:00Z',
  ...over,
})

const mine = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: 'fb-1',
  schoolId: 'GZU',
  authorKey: 'GZU:s1',
  kind: 'bug',
  body: '液体压强实验里拖动液面读数不动',
  status: 'answered',
  reply: '已确认,下个版本修复',
  createdAt: '2026-09-23T02:00:00Z',
  ...over,
})

const stubApi = (over: Partial<NoticeApi> = {}) => {
  const submitFeedback = vi.fn().mockResolvedValue({ item: mine() })
  const api = {
    listAnnouncements: vi.fn().mockResolvedValue({ items: [notice()] }),
    listFeedback: vi.fn().mockResolvedValue({ items: [mine()] }),
    submitFeedback,
    ...over,
  } as unknown as NoticeApi
  return { api, submitFeedback }
}

const store = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

const mount = (api: NoticeApi, storage?: ReturnType<typeof store>) =>
  render(
    <NoticeBoard
      api={api}
      context="/notice"
      {...(storage === undefined ? {} : { storage })}
      t={t}
    />,
  )
const bodyBox = () => screen.getByTestId('feedback-body')

describe('NoticeBoard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('shows platform announcements and the reports you already sent', async () => {
    const { api } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })

    expect(screen.getByText('实验中心新增四台装置')).toBeTruthy()
    /* What came back is listed so nobody files the same bug twice. */
    expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy()
    expect(screen.getByText(/已确认,下个版本修复/)).toBeTruthy()
  })

  it('labels an announcement by its scope', async () => {
    const { api } = stubApi({
      listAnnouncements: vi.fn().mockResolvedValue({
        items: [notice({ id: 'an-p', schoolId: null }), notice({ id: 'an-s', schoolId: 'GZU', title: '开学通知' })],
      }),
    })
    mount(api)
    await waitFor(() => { expect(screen.getByText('开学通知')).toBeTruthy() })

    /* The label shares its line with the timestamp, so match loosely. */
    expect(screen.getByText(/全平台/)).toBeTruthy()
    expect(screen.getByText(/本校/)).toBeTruthy()
  })

  it('sends the report with the kind and the page it came from', async () => {
    const { api, submitFeedback } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: '建议' }))
    fireEvent.change(bodyBox(), { target: { value: '希望能加一个磁场方向的可视化' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => { expect(submitFeedback).toHaveBeenCalledTimes(1) })
    expect(submitFeedback).toHaveBeenCalledWith({
      kind: 'idea',
      body: '希望能加一个磁场方向的可视化',
      context: '/notice',
    })
  })

  it('will not send an empty report', async () => {
    const { api, submitFeedback } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })

    expect(screen.getByRole('button', { name: '提交' }).disabled).toBe(true)
    /* Whitespace is not content either. */
    fireEvent.change(bodyBox(), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '提交' }).disabled).toBe(true)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('includes the contact field only when the reporter filled it in', async () => {
    const { api, submitFeedback } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })

    fireEvent.change(bodyBox(), { target: { value: '读数不对' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => { expect(submitFeedback).toHaveBeenCalledTimes(1) })
    /* No contact key at all — not an empty string the operator would read as
       "they left one but it is blank". */
    expect(submitFeedback.mock.calls[0]![0]).not.toHaveProperty('contact')
  })

  it('surfaces a failed load instead of an empty board', async () => {
    const { api } = stubApi({
      listAnnouncements: vi.fn().mockRejectedValue(new Error('boom')),
      listFeedback: vi.fn().mockResolvedValue({ items: [] }),
    })
    mount(api)
    await waitFor(() => { expect(screen.getByText('boom')).toBeTruthy() })
  })

  /* The defect this file grew a case for: the two panes used to share one
     `Promise.all`, so a notice-host failure took the bug-report form with it.
     A student whose 公告 fetch failed still has a bug to report. */
  it('keeps the feedback form when only the announcements fetch fails', async () => {
    const { api, submitFeedback } = stubApi({
      listAnnouncements: vi.fn().mockRejectedValue(new Error('offline')),
      listFeedback: vi.fn().mockResolvedValue({ items: [mine()] }),
    })
    mount(api)

    await waitFor(() => { expect(screen.getByText('offline')).toBeTruthy() })
    expect(bodyBox()).toBeTruthy()
    expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy()

    fireEvent.change(bodyBox(), { target: { value: '离线也要能提' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => { expect(submitFeedback).toHaveBeenCalledTimes(1) })
  })

  it('keeps the announcements when only the feedback fetch fails', async () => {
    const { api } = stubApi({
      listAnnouncements: vi.fn().mockResolvedValue({ items: [notice()] }),
      listFeedback: vi.fn().mockRejectedValue(new Error('feedback down')),
    })
    mount(api)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })
  })

  /* 方案 2.3: 断网时缓存上一条,不显示空白. */
  it('shows the last cached announcement when the host is unreachable', async () => {
    const storage = store()
    writeCachedAnnouncements(storage, [notice({ title: '上次收到的公告' })])

    const { api } = stubApi({
      listAnnouncements: vi.fn().mockRejectedValue(new Error('offline')),
      listFeedback: vi.fn().mockResolvedValue({ items: [] }),
    })
    mount(api, storage)

    await waitFor(() => { expect(screen.getByText('上次收到的公告')).toBeTruthy() })
    expect(screen.queryByText('暂无公告。')).toBeNull()
    /* And it is labelled as old, not passed off as current. */
    expect(screen.getByText(/当前离线/)).toBeTruthy()
  })

  it('caches what a successful fetch returned', async () => {
    const storage = store()
    const { api } = stubApi()
    mount(api, storage)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })
    expect(readCachedAnnouncements(storage).map(item => item.id)).toEqual(['an-1'])
  })

  it('does not claim staleness when the fetch succeeded', async () => {
    const storage = store()
    writeCachedAnnouncements(storage, [notice({ title: '旧的' })])
    const { api } = stubApi()
    mount(api, storage)
    await waitFor(() => { expect(screen.getByText('版本更新')).toBeTruthy() })
    expect(screen.queryByText(/当前离线/)).toBeNull()
  })
})
