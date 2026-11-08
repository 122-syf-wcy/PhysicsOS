// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminWebsiteTab } from '../src/client/AdminWebsiteTab.tsx'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import { WebsiteApiError, type WebsiteApi, type WebsiteContent, type WebsiteFeedback, type WebsiteTestimonial } from '../src/client/website-api.ts'
import type { AdminApi } from '../src/client/auth-api.ts'
import type { AuthState, AuthUser } from '../src/client/auth-store.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key
const testimonial = (over: Partial<WebsiteTestimonial> = {}): WebsiteTestimonial => ({
  id: 'quote-1', name: '真实用户', role: '教师', quote: '实验帮助学生理解概念', topic: '实验', color: '#51779c', order: 0, enabled: false, ...over,
})
const content = (over: Partial<WebsiteContent> = {}): WebsiteContent => ({
  version: 3, testimonials: [], contributors: [], updatedAt: '', updatedBy: '', ...over,
})
const feedback = (over: Partial<WebsiteFeedback> = {}): WebsiteFeedback => ({
  id: 'feedback-1', kind: 'idea', body: '实验帮助学生理解概念，期待更多内容。', contact: 'private@example.com', context: 'private browser detail', status: 'open', createdAt: '2026-11-08T01:00:00Z',
  images: [{ id: 'image-1', name: '截图.png', mediaType: 'image/png', url: '/physicsos/notice/website-feedback/feedback-1/images/image-1' }], ...over,
})
const mockApi = (initial = content()) => {
  const getContent = vi.fn().mockResolvedValue({ content: initial })
  const saveContent = vi.fn().mockImplementation(async input => ({ content: { ...initial, ...input, version: initial.version + 1 } }))
  const listFeedback = vi.fn().mockResolvedValue({ feedback: [feedback()], total: 1 })
  const replyFeedback = vi.fn().mockResolvedValue({ feedback: feedback({ status: 'answered', reply: '已收到建议' }) })
  const api: WebsiteApi = { getContent, saveContent, listFeedback, replyFeedback }
  return { api, getContent, saveContent, listFeedback, replyFeedback }
}
const mount = (initial = content()) => {
  const mocks = mockApi(initial)
  render(<AdminWebsiteTab api={mocks.api} t={t} />)
  return mocks
}
const auth = (role: AuthUser['role']) => <S,>(selector: (state: AuthState) => S): S => selector({ status: 'authed', user: {
  id: '1', username: 'admin', displayName: '管理员', schoolId: 'platform', schoolName: '平台', role,
} })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('official website administration', () => {
  it('offers the real website editor only to SUPER_ADMIN in the content group', async () => {
    const adminApi = { listUsers: async () => ({ users: [] }) } as unknown as AdminApi
    const { api, getContent } = mockApi()
    const first = render(<AdminWorkspace api={adminApi} websiteApi={api} useAuth={auth('SCHOOL_ADMIN')} t={t} />)
    expect(screen.queryByRole('tab', { name: '官网管理' })).toBeNull()
    first.unmount()
    render(<AdminWorkspace api={adminApi} websiteApi={api} useAuth={auth('SUPER_ADMIN')} t={t} />)
    const tab = screen.getByRole('tab', { name: '官网管理' })
    expect(tab.parentElement?.textContent).toContain('内容')
    fireEvent.click(tab)
    await screen.findByText('当前版本 3')
    expect(getContent).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-admin-page-header]')).toHaveLength(1)
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1)
  })

  it('accepts zero entries and saves the exact expected version', async () => {
    const { saveContent } = mount(content({ version: 0 }))
    await screen.findByText('当前版本 0')
    expect(screen.getByText('还没有展示反馈。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存官网配置' }))
    await waitFor(() => expect(saveContent).toHaveBeenCalledWith({ expectedVersion: 0, testimonials: [], contributors: [] }))
    expect(await screen.findByText('当前版本 1')).toBeTruthy()
  })

  it('edits ordering and visibility and retains unsaved edits when another administrator saves first', async () => {
    const { saveContent, getContent } = mount(content({ testimonials: [testimonial(), testimonial({ id: 'quote-2', name: '第二位用户', order: 1 })] }))
    await screen.findByDisplayValue('真实用户')
    fireEvent.change(screen.getAllByLabelText('展示姓名')[0]!, { target: { value: '待保存姓名' } })
    fireEvent.click(screen.getAllByLabelText('官网展示（保存后生效）')[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: '下移' })[0]!)
    saveContent.mockRejectedValueOnce(new WebsiteApiError(409, 'VERSION_CONFLICT', 'conflict'))
    fireEvent.click(screen.getByRole('button', { name: '保存官网配置' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('草稿已保留')
    expect(screen.getByDisplayValue('待保存姓名')).toBeTruthy()
    expect(saveContent.mock.calls[0]?.[0].testimonials).toEqual([
      expect.objectContaining({ id: 'quote-2', order: 0 }), expect.objectContaining({ id: 'quote-1', order: 1, name: '待保存姓名', enabled: true }),
    ])
    expect(getContent).toHaveBeenCalledTimes(1)
    getContent.mockResolvedValueOnce({ content: content({ version: 4 }) })
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿并重新载入' }))
    await screen.findByText('当前版本 4')
    expect(screen.queryByDisplayValue('待保存姓名')).toBeNull()
  })

  it('retries an initial failed load and refuses blank or unsafe contributor fields', async () => {
    const mocks = mockApi(content())
    mocks.getContent.mockRejectedValueOnce(new Error('network unavailable'))
    render(<AdminWebsiteTab api={mocks.api} t={t} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await screen.findByText('当前版本 3')
    fireEvent.click(screen.getByRole('button', { name: '贡献者与项目' }))
    fireEvent.click(screen.getByRole('button', { name: '添加贡献项目' }))
    const save = screen.getByRole('button', { name: '保存官网配置' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    for (const [label, value] of [['展示姓名', '开发者'], ['身份', '开源贡献者'], ['项目名称', '光学实验'], ['项目简介', '一个真实项目'], ['项目链接', 'https://example.com/project']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: 'https://user:password@example.com/avatar.png' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: 'javascript:alert(1)' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: 'https:example.com/avatar.png' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: 'https://example.com/avatar.png' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(mocks.saveContent).toHaveBeenCalledWith(expect.objectContaining({ contributors: [expect.objectContaining({ avatar: 'https://example.com/avatar.png', enabled: false })] })))
  })

  it('limits each collection to twelve and previews only enabled public fields', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => testimonial({ id: `q-${i}`, order: i, name: `用户${i}`, enabled: i === 0, sourceFeedbackId: 'private-source' }))
    mount(content({ testimonials: entries }))
    await screen.findByDisplayValue('用户0')
    expect((screen.getByRole('button', { name: '添加展示反馈' }) as HTMLButtonElement).disabled).toBe(true)
    const preview = screen.getByRole('region', { name: '发布预览' })
    expect(within(preview).getByText('用户0')).toBeTruthy()
    expect(within(preview).queryByText('用户1')).toBeNull()
    expect(preview.textContent).not.toContain('private-source')
  })

  it('filters and paginates feedback on the server and renders protected images only', async () => {
    const { listFeedback } = mount()
    await screen.findByText('当前版本 3')
    listFeedback.mockResolvedValue({ feedback: [feedback({ images: [...feedback().images, { id: 'external', name: 'unsafe.png', mediaType: 'image/png', url: 'https://external.example/private.png' }] })], total: 51 })
    fireEvent.click(screen.getByRole('button', { name: '官网反馈收件箱' }))
    await screen.findByText('private@example.com')
    expect(listFeedback).toHaveBeenLastCalledWith({ status: 'open', offset: 0, limit: 50 })
    const screenshot = screen.getByRole('img', { name: '截图.png' })
    expect(screenshot.getAttribute('src')).toBe('/physicsos/notice/website-feedback/feedback-1/images/image-1')
    expect(screen.queryByRole('img', { name: 'unsafe.png' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(listFeedback).toHaveBeenLastCalledWith({ status: 'open', offset: 50, limit: 50 }))
    fireEvent.click(screen.getByRole('combobox', { name: '反馈状态' }))
    fireEvent.click(screen.getByRole('option', { name: '已回复' }))
    await waitFor(() => expect(listFeedback).toHaveBeenLastCalledWith({ status: 'answered', offset: 0, limit: 50 }))
  })

  it('creates an unpublished editable draft without contacts or screenshots and requires deliberate publication', async () => {
    const { saveContent } = mount()
    await screen.findByText('当前版本 3')
    fireEvent.click(screen.getByRole('button', { name: '官网反馈收件箱' }))
    await screen.findByText('private@example.com')
    fireEvent.click(screen.getByRole('button', { name: '转为展示草稿' }))
    const name = screen.getByLabelText('展示姓名') as HTMLInputElement
    expect(name.value).toBe('')
    expect((screen.getByLabelText('身份') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('官网展示（保存后生效）') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('private@example.com')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(saveContent).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: '已授权姓名' } })
    fireEvent.change(screen.getByLabelText('身份'), { target: { value: '教师' } })
    fireEvent.click(screen.getByRole('button', { name: '保存官网配置' }))
    await waitFor(() => expect(saveContent).toHaveBeenCalled())
    const saved = saveContent.mock.calls[0]?.[0]
    expect(saved.testimonials[0]).toEqual(expect.objectContaining({ sourceFeedbackId: 'feedback-1', enabled: false, name: '已授权姓名' }))
    expect(JSON.stringify(saved)).not.toContain('private@example.com')
    expect(JSON.stringify(saved)).not.toContain('image-1')
  })

  it('requires a reply, closes feedback, and keeps reply text when submission fails', async () => {
    const { replyFeedback } = mount()
    await screen.findByText('当前版本 3')
    fireEvent.click(screen.getByRole('button', { name: '官网反馈收件箱' }))
    await screen.findByText('private@example.com')
    const button = screen.getByRole('button', { name: '回复并关闭' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const reply = screen.getByLabelText('处理回复')
    fireEvent.change(reply, { target: { value: '已处理，感谢反馈' } })
    replyFeedback.mockRejectedValueOnce(new Error('temporarily unavailable'))
    fireEvent.click(button)
    await screen.findByRole('alert')
    expect((reply as HTMLTextAreaElement).value).toBe('已处理，感谢反馈')
    fireEvent.click(button)
    await waitFor(() => expect(replyFeedback).toHaveBeenLastCalledWith('feedback-1', { reply: '已处理，感谢反馈', status: 'closed' }))
  })
})
