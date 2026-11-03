// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContributionPanel } from '../src/client/experiments/ContributionPanel.tsx'
import type { ExperimentPackageView } from '../src/client/experiments/contribution-api.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows committed approval immediately and keeps the preview while the catalog refresh is pending', async () => {
  const pending: ExperimentPackageView = {
    id: 'package-1',
    experimentId: 'convex-lens',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    status: 'pending',
    author: { name: '作者' },
    createdAt: '2026-11-03T00:00:00Z',
  }
  const approved: ExperimentPackageView = {
    ...pending,
    status: 'approved',
    entryUrl: '/physicsos/experiment-assets/embed/releases/package-1/hash/dist/index.html',
  }
  let catalogs = 0
  let finishRefresh: (() => void) | undefined
  const json = (data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/review')) return json({ item: approved })
    if (input.endsWith('/preview'))
      return json({
        entryUrl: '/physicsos/experiment-assets/embed/preview/example/dist/index.html',
      })
    catalogs += 1
    if (catalogs === 1) return json({ active: null, items: [pending], canReview: true })
    return new Promise<Response>((resolve) => {
      finishRefresh = () => {
        resolve(json({ active: approved, items: [approved], canReview: true }))
      }
    })
  })
  render(<ContributionPanel onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览 v1.0.0', exact: true }))
  const frame = await screen.findByTitle('候选三维实验')
  fireEvent.click(screen.getByRole('button', { name: '审核通过并发布', exact: true }))
  await waitFor(() => {
    expect(screen.getAllByRole('status').some(node => node.textContent?.includes('已发布'))).toBe(
      true,
    )
  })
  expect(screen.getByTitle('候选三维实验')).toBe(frame)
  expect(screen.getAllByText('当前默认')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '审核通过并发布', exact: true })).toBeNull()
  await act(async () => {
    finishRefresh?.()
    await Promise.resolve()
  })
})
