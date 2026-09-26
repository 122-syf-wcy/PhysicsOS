// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminDashboardTab } from '../src/client/AdminDashboardTab.tsx'
import type { AdminApi, DashboardRow } from '../src/client/auth-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const row = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  schools: { total: 3, active: 2, disabled: 1 },
  users: { total: 6, byRole: { STUDENT: 3, TEACHER: 1, SCHOOL_ADMIN: 1, SUPER_ADMIN: 1 }, disabled: 1 },
  sessions: { live: 4, distinctUsers: 3 },
  activity: Array.from({ length: 14 }, (_, index) => ({
    date: `2026-09-${String(11 + index).padStart(2, '0')}`,
    logins: index % 3,
    created: index % 2,
  })),
  limiters: {
    login: { tracked: 0, saturated: 0, limit: 5, windowMs: 60_000 },
    ip: { tracked: 0, saturated: 0, limit: 20, windowMs: 60_000 },
    apply: { tracked: 0, saturated: 0, limit: 10, windowMs: 60_000 },
    backend: 'memory',
    available: true,
  },
  /* 默认「这台部署还没有人上报」——第二层据此说人话,而不是画一根 0% 的柱子。 */
  learning: { available: false, attempts: 0, correct: 0, wrong: 0, nodes: [], days: 0 },
  ...over,
})

/* Only `dashboard` is stubbed: the tab must not be calling anything else, and a
   stub that implemented the whole admin surface would hide it doing so. */
const stubApi = (data: DashboardRow): AdminApi =>
  ({ dashboard: vi.fn().mockResolvedValue(data) } as unknown as AdminApi)

const mount = (api: AdminApi) => render(<AdminDashboardTab api={api} t={t} />)

const statOf = (bucket: string): string | undefined =>
  document.querySelector(`[data-stat="${bucket}"] strong`)?.textContent ?? undefined

describe('AdminDashboardTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('reads each figure off its own stat', async () => {
    mount(stubApi(row()))
    await waitFor(() => { expect(statOf('schools')).toBe('3') })

    expect(statOf('schools')).toBe('3')
    expect(statOf('schoolsActive')).toBe('2')
    expect(statOf('users')).toBe('6')
    expect(statOf('usersDisabled')).toBe('1')
    expect(statOf('sessions')).toBe('4')
    expect(statOf('sessionsDistinct')).toBe('3')
  })

  it('splits accounts by role rather than showing one total', async () => {
    /* "6 accounts" answers nothing. "3 students, 1 teacher" is the question an
       operator opens this tab with. */
    mount(stubApi(row()))
    await waitFor(() => { expect(statOf('role.STUDENT')).toBe('3') })

    expect(statOf('role.STUDENT')).toBe('3')
    expect(statOf('role.TEACHER')).toBe('1')
    expect(statOf('role.SCHOOL_ADMIN')).toBe('1')
  })

  it('draws a 14-day strip and every day is labelled', async () => {
    mount(stubApi(row()))
    await waitFor(() => { expect(document.querySelectorAll('[title^="2026-"]').length).toBe(14) })
    expect(document.querySelectorAll('[title^="2026-"]').length).toBe(14)
  })

  it('explains an empty second layer instead of inventing numbers', async () => {
    /* 学习记录 lives in the browser's localStorage and the server still cannot
       read it. The second layer is a SEPARATE opt-in channel, so when nobody has
       reported yet the honest thing is prose — no figure, no 0% bar. */
    mount(stubApi(row()))
    await waitFor(() => { expect(screen.getByText('实验与自测成效')).toBeTruthy() })

    const gap = document.querySelector('[data-gap="learning-analytics"]')
    expect(gap).not.toBeNull()
    expect(gap?.textContent).toContain('还没有收到任何上报')
    expect(gap?.querySelector('strong')).toBeNull()
  })

  it('draws the real aggregate once reports exist, worst knowledge first', async () => {
    mount(stubApi(row({
      learning: {
        available: true,
        attempts: 9,
        correct: 4,
        wrong: 5,
        /* 错得多的在前 —— 看板是拿来决定下一节课讲什么的。 */
        nodes: [
          { knowledgeId: 'circ-ohm-law', correct: 1, wrong: 4 },
          { knowledgeId: 'opt-lens-imaging', correct: 3, wrong: 1 },
        ],
        days: 2,
      },
    })))
    await waitFor(() => { expect(statOf('learningWrong')).toBe('5') })

    expect(statOf('learningCorrect')).toBe('4')
    const nodes = document.querySelectorAll('[data-learning-nodes] li')
    expect(nodes.length).toBe(2)
    expect(nodes[0]?.getAttribute('data-knowledge')).toBe('circ-ohm-law')
    expect(nodes[1]?.getAttribute('data-knowledge')).toBe('opt-lens-imaging')
    /* 有数据时不再出现「为什么空」的说明。 */
    const gap = document.querySelector('[data-gap="learning-analytics"]')
    expect(gap?.textContent).not.toContain('还没有收到任何上报')
  })

  it('surfaces a failed load instead of an empty dashboard', async () => {
    const api = {
      dashboard: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as AdminApi
    mount(api)
    await waitFor(() => { expect(screen.getByText('boom')).toBeTruthy() })
  })
})
