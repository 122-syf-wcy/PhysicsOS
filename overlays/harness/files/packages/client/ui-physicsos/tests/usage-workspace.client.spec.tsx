// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageWorkspace } from '../src/client/UsageWorkspace.tsx'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'
import type { UsageSummary } from '../src/client/usage-api.ts'

const t = (key: PhysicsosKey): string => zh[key]
const tokens = (totalTokens: number) => ({ inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens })
const summary: UsageSummary = {
  scope: 'account', timezone: 'Asia/Shanghai', from: '2026-11-01', to: '2026-11-02',
  visits: 12, uses: 7, activeDays: 2, tokens: tokens(500), coverage: { reportedCalls: 7, missingCalls: 0 },
  system: { tokens: tokens(0), reportedCalls: 0, missingCalls: 0 }, updatedAt: '2026-11-02T10:00:00Z',
  daily: [
    { date: '2026-11-01', visits: 5, uses: 3, tokens: tokens(200), reportedCalls: 3, missingCalls: 0 },
    { date: '2026-11-02', visits: 7, uses: 4, tokens: tokens(300), reportedCalls: 4, missingCalls: 0 },
  ],
}

describe('usage metric selection', () => {
  afterEach(cleanup)
  it('switches one metric at a time while retaining the raw table and account scope', async () => {
    const api = { summary: vi.fn().mockResolvedValue(summary), adminSummary: vi.fn() }
    render(<UsageWorkspace api={api} t={t} />)
    const controls = await screen.findByRole('group', { name: zh['usage.history'] })
    expect(screen.getByRole('img', { name: `${zh['usage.visits']}（${zh['usage.date']} / ${zh['usage.visits']}）` })).toBeTruthy()
    fireEvent.click(within(controls).getByRole('button', { name: zh['usage.tokens.total'] }))
    expect(screen.getByRole('img', { name: `${zh['usage.tokens.total']}（${zh['usage.date']} / ${zh['usage.tokens.total']}）` })).toBeTruthy()
    expect(screen.queryByRole('img', { name: `${zh['usage.visits']}（${zh['usage.date']} / ${zh['usage.visits']}）` })).toBeNull()
    const table = screen.getByRole('table')
    expect(within(table).getByText('2026-11-01')).toBeTruthy()
    expect(within(table).getByText('200')).toBeTruthy()
    expect(within(table).getByText('300')).toBeTruthy()
    await waitFor(() => { expect(api.summary).toHaveBeenCalledTimes(1) })
    expect(api.adminSummary).not.toHaveBeenCalled()
  })
})
