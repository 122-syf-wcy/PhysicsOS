// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NoticeBoard } from '../src/client/NoticeBoard.tsx'
import type { FeedbackRow, NoticeApi } from '../src/client/notice-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

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
  const listAnnouncements = vi.fn().mockResolvedValue({ items: [] })
  const api = {
    listFeedback: vi.fn().mockResolvedValue({ items: [mine()] }),
    submitFeedback,
    listAnnouncements,
    ...over,
  } as unknown as NoticeApi
  return { api, submitFeedback, listAnnouncements }
}

const mount = (api: NoticeApi) =>
  render(<NoticeBoard api={api} context="/notice" t={t} />)

const bodyBox = () => screen.getByTestId('feedback-body')

describe('NoticeBoard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('keeps only feedback on the page; announcements are the shell modal', async () => {
    const { api, listAnnouncements } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy() })

    expect(screen.getByRole('heading', { level: 1, name: '反馈' })).toBeTruthy()
    expect(screen.queryByText('公告')).toBeNull()
    expect(screen.queryByTestId('notice-announcements')).toBeNull()
    expect(listAnnouncements).not.toHaveBeenCalled()
  })

  it('sends the report with the kind and the page it came from', async () => {
    const { api, submitFeedback } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy() })

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
    await waitFor(() => { expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy() })

    const button = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(bodyBox(), { target: { value: '   ' } })
    expect(button.disabled).toBe(true)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('includes the contact field only when the reporter filled it in', async () => {
    const { api, submitFeedback } = stubApi()
    mount(api)
    await waitFor(() => { expect(screen.getByText('液体压强实验里拖动液面读数不动')).toBeTruthy() })

    fireEvent.change(bodyBox(), { target: { value: '读数不对' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => { expect(submitFeedback).toHaveBeenCalledTimes(1) })
    expect(submitFeedback.mock.calls[0]![0]).not.toHaveProperty('contact')
  })

  it('surfaces a failed feedback load instead of pretending the form worked', async () => {
    const { api } = stubApi({
      listFeedback: vi.fn().mockRejectedValue(new Error('feedback down')),
    })
    mount(api)
    await waitFor(() => { expect(screen.getByText('feedback down')).toBeTruthy() })
    expect(bodyBox()).toBeTruthy()
  })
})
