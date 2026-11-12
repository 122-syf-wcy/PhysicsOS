// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContributionPanel } from '../src/client/experiments/ContributionPanel.tsx'
import { contributionApi } from '../src/client/experiments/contribution-api.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const item = (id: string, status: string) => ({ id, experimentId: 'convex-lens', version: `1.0.${id === 'pending' ? '1' : '2'}`, sha256: 'a'.repeat(64), status, author: { name: id }, createdAt: '2026-11-04T00:00:00Z' })

it('offers every existing experiment and routes a selected target catalog correctly', async () => {
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: string) => { paths.push(url); return json({ active: null, items: [], canReview: false }) })
  render(<ContributionPanel embedded />)
  await screen.findByText('PhysicsOS 官方实验样板', { exact: false })
  const choice = screen.getByRole('combobox', { name: '对应实验' })
  expect(choice.textContent).toContain('凸透镜成像规律')
  fireEvent.click(choice)
  expect(screen.getAllByRole('option')).toHaveLength(76)
  expect(screen.getAllByRole('option').every(option => option.getAttribute('aria-disabled') !== 'true')).toBe(true)
  fireEvent.click(screen.getByRole('option', { name: '小孔成像' }))
  await waitFor(() => expect(paths).toContain('/physicsos/experiments/pinhole'))
  expect(choice.textContent).toContain('小孔成像')
})

it('uses the explicitly selected experiment in the upload route', async () => {
  let path = ''
  vi.stubGlobal('fetch', async (url: string) => { path = url; return json({ item: item('pending', 'pending') }) })
  await contributionApi.upload({ zipBase64: 'AA==', author: { name: '作者' } }, 'convex-lens')
  expect(path).toBe('/physicsos/experiments/convex-lens/packages')
  await contributionApi.upload({ zipBase64: 'AA==', author: { name: '作者' } }, 'unsupported-target')
  expect(path).toBe('/physicsos/experiments/unsupported-target/packages')
})

it('provides a review queue with status filtering and no upload form', async () => {
  vi.stubGlobal('fetch', async () => json({ active: null, items: [item('pending', 'pending'), item('approved', 'approved')], canReview: true }))
  render(<ContributionPanel embedded mode="review" />)
  await screen.findByRole('button', { name: '预览 v1.0.1' })
  expect(screen.queryByRole('button', { name: '上传并提交审核' })).toBeNull()
  expect(screen.queryByRole('button', { name: '预览 v1.0.2' })).toBeNull()
  fireEvent.click(screen.getByRole('combobox', { name: '审核状态' }))
  fireEvent.click(screen.getByRole('option', { name: '已通过' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '预览 v1.0.2' })).toBeTruthy())
  expect(screen.queryByRole('button', { name: '预览 v1.0.1' })).toBeNull()
})

it('does not offer a review queue when the server denies review permission', async () => {
  vi.stubGlobal('fetch', async () => json({ active: null, items: [item('pending', 'pending')], canReview: false }))
  render(<ContributionPanel embedded mode="review" />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('平台管理员'))
  expect(screen.queryByRole('button', { name: '预览 v1.0.1' })).toBeNull()
})
