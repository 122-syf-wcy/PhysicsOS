// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContributionPanel } from '../src/client/experiments/ContributionPanel.tsx'
import { contributionApi } from '../src/client/experiments/contribution-api.ts'
import { SidebarNav, type SidebarNavProps } from '../src/client/SidebarNav.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const catalog = () =>
  new Response(JSON.stringify({ active: null, items: [], canReview: false }), {
    headers: { 'content-type': 'application/json' },
  })

it('offers a clearly named upload destination on the compact sidebar', () => {
  const openSurface = vi.fn()
  const props = {
    wide: false,
    openSurface,
    t: (key) => zh[key],
    usePhysicsSurface: (select) => select({ surface: 'home' }),
    useAuth: (select) => select({ status: 'guest' }),
  } as SidebarNavProps
  render(<SidebarNav {...props} />)
  const entry = screen.getByRole('button', { name: '实验上传', exact: true })
  fireEvent.click(entry)
  expect(openSurface).toHaveBeenCalledWith('contribute')
})

it('renders the actual upload form as a normal page without dialog focus trapping', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => catalog()),
  )
  render(
    <>
      <button type="button">页外导航</button>
      <ContributionPanel embedded />
    </>,
  )
  await screen.findByText('PhysicsOS 官方三维样板', { exact: false })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByLabelText('实验文件 ZIP', { exact: false }).getAttribute('type')).toBe('file')
  expect(screen.getByRole('button', { name: '上传并提交审核' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '关闭贡献实验' })).toBeNull()
  const first = screen.getByRole('link', { name: '开发文档 ↗' })
  first.focus()
  expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(true)
  fireEvent.keyDown(first, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '上传并提交审核' })).toBeTruthy()
})

it('reports an unavailable non-JSON service clearly and permits a successful catalog retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('<html>missing</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    )
    .mockResolvedValueOnce(catalog())
  vi.stubGlobal('fetch', fetcher)
  await expect(contributionApi.catalog()).rejects.toThrow('实验上传服务暂不可用')
  await expect(contributionApi.catalog()).resolves.toMatchObject({ items: [], canReview: false })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('shows a sign-in error without enabling upload when the session has expired', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 401 })),
  )
  render(<ContributionPanel embedded />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('请先登录'))
  expect(
    (screen.getByRole('button', { name: '上传并提交审核' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
