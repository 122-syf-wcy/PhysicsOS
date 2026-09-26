// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminOpsPanel } from '../src/client/AdminOpsPanel.tsx'
import { AdminOpsTab } from '../src/client/AdminOpsTab.tsx'
import type { AdminApi, DashboardRow, OpsMetrics } from '../src/client/auth-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const dashboard = (): DashboardRow => ({
  schools: { total: 1, active: 1, disabled: 0 },
  users: { total: 1, byRole: { STUDENT: 1 }, disabled: 0 },
  sessions: { live: 1, distinctUsers: 1 },
  activity: [],
  learning: { available: false, attempts: 0, correct: 0, wrong: 0, nodes: [], days: 0 },
  limiters: {
    login: { tracked: 0, saturated: 0, limit: 5, windowMs: 60_000 },
    ip: { tracked: 0, saturated: 0, limit: 20, windowMs: 60_000 },
    apply: { tracked: 0, saturated: 0, limit: 10, windowMs: 60_000 },
  },
})

const metrics = (usedPercent = 30): OpsMetrics => ({
  cache: {
    ttlMs: 15_000,
    hit: false,
    collectedAt: '2026-09-26T10:00:00.000Z',
    partial: false,
  },
  disk: {
    thresholds: { warningPercent: 85, criticalPercent: 92 },
    root: {
      path: '/',
      totalBytes: 100,
      freeBytes: 100 - usedPercent,
      availableBytes: 100 - usedPercent,
      usedBytes: usedPercent,
      usedPercent,
      available: true,
    },
    data: {
      path: '/data',
      totalBytes: 100,
      freeBytes: 70,
      availableBytes: 70,
      usedBytes: 30,
      usedPercent: 30,
      available: true,
    },
    breakdown: {
      sessions: { path: '/data/sessions', bytes: 10, entries: 2, partial: false },
      workspaces: { path: '/data/workspaces', bytes: 20, entries: 3, partial: false },
      postgres: { bytes: 30, available: true, partial: false },
      redis: { bytes: 4, available: true, partial: false },
    },
    partial: false,
  },
  health: {
    status: 'ok',
    uptimeSeconds: 3_700,
    node: { version: 'v24.0.0', platform: 'linux', arch: 'x64' },
    postgres: { ok: true, latencyMs: 3, sizeBytes: 30 },
    redis: { ok: true, latencyMs: 1, usedMemoryBytes: 4 },
    sessions: { live: 2, distinctUsers: 1 },
    accounts: { total: 5, active: 4, disabled: 1 },
  },
  alerts: [],
  partial: false,
})

const api = (opsMetrics: ReturnType<typeof vi.fn>): AdminApi => ({
  opsMetrics,
  dashboard: vi.fn().mockResolvedValue(dashboard()),
  createUser: vi.fn(),
  setUserStatus: vi.fn(),
} as unknown as AdminApi)

describe('AdminOpsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders healthy metrics and forces a refresh on demand', async () => {
    const opsMetrics = vi.fn().mockResolvedValue(metrics())
    render(<AdminOpsPanel api={api(opsMetrics)} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('ops-disk-card')).toBeTruthy() })

    expect(screen.getByTestId('ops-disk-card').getAttribute('data-severity')).toBe('ok')
    fireEvent.click(screen.getByTestId('ops-metrics-refresh'))
    await waitFor(() => { expect(opsMetrics).toHaveBeenLastCalledWith(true) })
  })

  it('uses warning and critical severity at the disk thresholds', async () => {
    const warning = vi.fn().mockResolvedValue(metrics(86))
    const first = render(<AdminOpsPanel api={api(warning)} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('ops-disk-card').getAttribute('data-severity')).toBe('warning') })
    first.unmount()

    const critical = vi.fn().mockResolvedValue(metrics(93))
    render(<AdminOpsPanel api={api(critical)} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('ops-disk-card').getAttribute('data-severity')).toBe('critical') })
  })

  it('pauses the 30-second automatic refresh', async () => {
    vi.useFakeTimers()
    const opsMetrics = vi.fn().mockResolvedValue(metrics())
    render(<AdminOpsPanel api={api(opsMetrics)} t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(opsMetrics).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('ops-metrics-pause'))
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(opsMetrics).toHaveBeenCalledTimes(1)
  })

  it('marks a partial sample without hiding the available data', async () => {
    const partial = metrics()
    const opsMetrics = vi.fn().mockResolvedValue({
      ...partial,
      partial: true,
      cache: { ...partial.cache, partial: true },
    })
    render(<AdminOpsPanel api={api(opsMetrics)} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('ops-metrics-partial')).toBeTruthy() })
    expect(screen.getByTestId('ops-disk-card')).toBeTruthy()
  })

  it('does not request metrics for a non-super admin', async () => {
    const opsMetrics = vi.fn().mockResolvedValue(metrics())
    render(<AdminOpsTab api={api(opsMetrics)} isSuper={false} t={t} />)
    await waitFor(() => { expect(screen.getByTestId('ops-csv')).toBeTruthy() })
    expect(opsMetrics).not.toHaveBeenCalled()
  })
})
