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
  expect(
    screen.getByRole('link', { name: '下载冻结审核 ZIP', exact: true }).getAttribute('href'),
  ).toBe('/physicsos/experiments/packages/package-1/archive')
  expect(screen.getByLabelText('审核文件 SHA-256').textContent).toBe(pending.sha256)
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

it('requires the current V2 candidate first render, resets on failure and candidate selection', async () => {
  const packages = ['a', 'b'].map((id, index) => ({
    id,
    experimentId: 'convex-lens',
    version: `2.0.${index}`,
    schemaVersion: 2,
    protocolVersion: 2,
    sha256: id.repeat(64),
    status: 'pending',
    author: { name: id },
    createdAt: '2026-11-03T00:00:00Z',
  }))
  vi.stubGlobal(
    'fetch',
    async (input: string) =>
      new Response(
        JSON.stringify(
          input.endsWith('/preview')
            ? {
              entryUrl: `/physicsos/experiment-assets/embed/preview/${input.includes('/a/') ? 'a' : 'b'}/dist/index.html`,
            }
            : { active: null, items: packages, canReview: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  )
  const ports: {
    onmessage?: (event: { data: unknown }) => void
    sent: Record<string, unknown>[]
    postMessage: (data: Record<string, unknown>) => void
    start: () => void
    close: () => void
  }[] = []
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = (() => {
        const sent: Record<string, unknown>[] = []
        const port = {
          sent,
          postMessage: (data: Record<string, unknown>) => sent.push(data),
          start: () => {},
          close: () => {},
        }
        ports.push(port)
        return port
      })()
      port2 = {}
    },
  )
  const view = render(<ContributionPanel onClose={() => {}} />)
  const bind = async () => {
    const frame = (await screen.findByTitle('候选三维实验')) as HTMLIFrameElement
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: location.origin,
          data: {
            type: 'experiment/ready',
            protocolVersion: 2,
            channel: new URL(frame.src).searchParams.get('channel'),
          },
        }),
      ),
    )
    const port = ports.at(-1)!
    act(() => port.onmessage?.({ data: { type: 'experiment/connected', protocolVersion: 2 } }))
    return port
  }
  const approve = () => screen.getByRole<HTMLButtonElement>('button', { name: '审核通过并发布' })
  fireEvent.click(await screen.findByRole('button', { name: '预览 v2.0.0', exact: true }))
  await screen.findByTitle('候选三维实验')
  expect(approve().disabled).toBe(true)
  const first = await bind()
  expect(approve().disabled).toBe(true)
  const acknowledge = (): void => {
    act(() => {
      first.onmessage?.({
        data: {
          type: 'experiment/rendered',
          protocolVersion: 2,
          frameId: first.sent[0]?.frameId,
          revision: 0,
        },
      })
    })
  }
  acknowledge()
  expect(approve().disabled).toBe(false)
  act(() =>
    first.onmessage?.({
      data: { type: 'experiment/error', protocolVersion: 2, code: 'RENDER_FAILED' },
    }),
  )
  expect(approve().disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '预览 v2.0.1', exact: true }))
  await waitFor(() => { expect(view.getByRole('heading', { name: '预览 v2.0.1 · b' })).toBeTruthy() })
  acknowledge()
  expect(approve().disabled).toBe(true)
})
