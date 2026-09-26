// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ActivityHeatmap,
  activityLevelOf,
  buildActivityCalendar,
} from '../src/client/ActivityHeatmap.tsx'
import type { StudentAttempt } from '../src/client/learning-record-store.ts'

const NOW = new Date(2026, 8, 26, 12, 0, 0)

const attempt = (
  id: string,
  at: Date,
  correct = true,
): StudentAttempt => ({
  id,
  questionId: 'q-1',
  questionTitle: '练习',
  selfCheckId: 'self-check-1',
  prompt: 'prompt',
  answerId: 'answer',
  answerLabel: 'answer',
  correct,
  knowledge: [],
  at: at.toISOString(),
})

afterEach(cleanup)

describe('activity heatmap aggregation', () => {
  it('maps counts to the five contract levels at their boundaries', () => {
    expect([-1, 0, 1, 2, 3, 4, 5, 7, 8, 99].map(activityLevelOf)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ])
  })

  it('aligns the Monday-first grid and reserves 53 full weeks', () => {
    const calendar = buildActivityCalendar([], NOW)
    const target = calendar.days.find(day => day.key === '2026-09-26')

    expect(calendar.days).toHaveLength(371)
    expect(target).toMatchObject({ row: 5, column: 52 })
    expect(calendar.start.getDay()).toBe(1)
    expect(calendar.end.getDay()).toBe(0)
    /* The window starts mid-September, so the first label is the first full
       month; the partial September label is suppressed rather than overlapped. */
    expect(calendar.monthLabels[0]).toMatchObject({ column: 1, label: 'Oct' })
  })

  it('aggregates counts and correctness inside the selected window', () => {
    const calendar = buildActivityCalendar([
      attempt('a', new Date(2026, 8, 26, 9)),
      attempt('b', new Date(2026, 8, 26, 10), false),
      attempt('c', new Date(2024, 0, 1)),
    ], NOW)
    const target = calendar.days.find(day => day.key === '2026-09-26')

    expect(target).toMatchObject({ count: 2, correct: 1, level: 1 })
    expect(calendar.total).toBe(2)
    expect(calendar.accuracy).toBe(50)
  })
})

describe('ActivityHeatmap surface', () => {
  it('renders a complete empty year and an accessible cell label', () => {
    render(<ActivityHeatmap attempts={[]} now={NOW} />)

    expect(document.querySelectorAll('[data-activity-cell]')).toHaveLength(371)
    expect(screen.getByRole('heading', { name: /过去一年完成 0 次练习/ })).toBeTruthy()
    expect(screen.getByLabelText('2026-09-26 · 当天 0 次练习 · 正确 0')).toBeTruthy()
  })

  it('switches the whole view to the previous year', () => {
    render(
      <ActivityHeatmap
        attempts={[
          attempt('current-1', new Date(2026, 8, 26, 9)),
          attempt('current-2', new Date(2026, 8, 25, 9), false),
          attempt('previous-1', new Date(2025, 8, 1, 9)),
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByRole('heading', { name: /过去一年完成 2 次练习/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    expect(screen.getByRole('heading', { name: /过去一年完成 1 次练习/ })).toBeTruthy()
    expect(screen.getByLabelText('2025-09-01 · 当天 1 次练习 · 正确 1')).toBeTruthy()
  })

  it('exposes the daily count and correctness in the cell label', () => {
    render(
      <ActivityHeatmap
        attempts={[
          attempt('a', new Date(2026, 8, 26, 9)),
          attempt('b', new Date(2026, 8, 26, 10), false),
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByLabelText('2026-09-26 · 当天 2 次练习 · 正确 1')).toBeTruthy()
  })
})
