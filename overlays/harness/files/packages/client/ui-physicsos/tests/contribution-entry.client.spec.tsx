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

it('uses the Chinese file action, shows selection details and removes the pending ZIP', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => catalog()),
  )
  render(<ContributionPanel embedded />)
  await screen.findByText('PhysicsOS 官方三维样板', { exact: false })
  const input = screen.getByLabelText('实验文件 ZIP', { exact: false }) as HTMLInputElement
  const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: '选择 ZIP 文件', exact: true }))
  expect(openPicker).toHaveBeenCalledOnce()
  fireEvent.change(input, {
    target: {
      files: [new File([new Uint8Array(2048)], 'my-lens.zip', { type: 'application/zip' })],
    },
  })
  expect(screen.getByText('my-lens.zip')).toBeTruthy()
  expect(screen.getByText('2 KiB')).toBeTruthy()
  expect(screen.getByRole('button', { name: '更换实验文件', exact: true })).toBeTruthy()
  const remove = screen.getByRole('button', { name: '移除实验文件', exact: true })
  remove.focus()
  fireEvent.click(remove)
  expect(screen.queryByText('my-lens.zip')).toBeNull()
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: '选择 ZIP 文件', exact: true }),
  )
  expect(
    (screen.getByRole('button', { name: '上传并提交审核' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  openPicker.mockRestore()
})
