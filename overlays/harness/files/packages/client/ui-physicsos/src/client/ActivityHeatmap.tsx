/**
 * GitHub-style learning activity heatmap.
 *
 * The grid is a rolling 53-week window ending on the Sunday of the selected
 * anchor date. It deliberately renders every cell, even with no attempts, so
 * the year always reads as a full calendar rather than a blank card.
 */

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { StudentAttempt } from './learning-record-store.ts'
import css from './ActivityHeatmap.module.css'

const WEEKS = 53
const DAYS_PER_WEEK = 7
const CELL_COUNT = WEEKS * DAYS_PER_WEEK
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const
const WEEKDAY_LABELS = ['周一', '', '周三', '', '周五', '', ''] as const

export type ActivityLevel = 0 | 1 | 2 | 3 | 4

/** Map a day's practice count to the five GitHub-style intensity levels. */
export const activityLevelOf = (count: number): ActivityLevel => {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 4) return 2
  if (count <= 7) return 3
  return 4
}

export interface ActivityDay {
  readonly date: Date
  readonly key: string
  readonly row: number
  readonly column: number
  readonly count: number
  readonly correct: number
  readonly level: ActivityLevel
  readonly future: boolean
}

export interface ActivityMonthLabel {
  readonly column: number
  readonly label: string
}

export interface ActivityCalendar {
  readonly anchor: Date
  readonly start: Date
  readonly end: Date
  readonly days: readonly ActivityDay[]
  readonly monthLabels: readonly ActivityMonthLabel[]
  readonly total: number
  readonly correct: number
  readonly accuracy: number
  readonly longestStreak: number
}

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return new Date(next.getFullYear(), next.getMonth(), next.getDate())
}

const addYearsClamped = (date: Date, years: number): Date => {
  const next = new Date(date)
  next.setFullYear(next.getFullYear() + years)
  /* Feb 29 has no counterpart in a common year; clamp it to Feb 28. */
  if (next.getMonth() !== date.getMonth()) next.setDate(0)
  return next
}

const mondayOf = (date: Date): Date =>
  addDays(date, -((date.getDay() + 6) % DAYS_PER_WEEK))

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** Stable local-date key used for tooltips and tests. */
export const activityDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const parseDate = (value: Date | number | string | undefined): Date => {
  if (value === undefined) return new Date()
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

const monthLabelsOf = (days: readonly ActivityDay[]): ActivityMonthLabel[] => {
  const raw: ActivityMonthLabel[] = []
  const firstDay = days[0]
  if (firstDay === undefined) return raw

  raw.push({ column: 0, label: MONTH_LABELS[firstDay.date.getMonth()] ?? 'Jan' })
  for (let column = 1; column < WEEKS; column += 1) {
    const firstOfMonth = days
      .slice(column * DAYS_PER_WEEK, (column + 1) * DAYS_PER_WEEK)
      .find(day => day.date.getDate() === 1)
    if (firstOfMonth !== undefined) {
      raw.push({
        column,
        label: MONTH_LABELS[firstOfMonth.date.getMonth()] ?? 'Jan',
      })
    }
  }

  /* Month names are wider than one 13px column. Drop the earlier label when
     a partial starting month would collide with the next full month. */
  const labels: ActivityMonthLabel[] = []
  for (const label of raw) {
    const previous = labels[labels.length - 1]
    if (previous !== undefined && label.column - previous.column < 3) labels.pop()
    labels.push(label)
  }
  return labels
}

/** Aggregate attempts into a fixed 53 × 7 activity calendar. */
export function buildActivityCalendar(
  attempts: readonly Pick<StudentAttempt, 'at' | 'correct'>[],
  now: Date | number | string,
): ActivityCalendar {
  const anchor = startOfDay(parseDate(now))
  const end = addDays(mondayOf(anchor), DAYS_PER_WEEK - 1)
  const start = addDays(end, -(CELL_COUNT - 1))

  const byDay = new Map<string, { count: number; correct: number }>()
  for (const attempt of attempts) {
    const at = new Date(attempt.at)
    if (Number.isNaN(at.getTime())) continue
    const day = startOfDay(at)
    if (day.getTime() < start.getTime() || day.getTime() > end.getTime()) continue
    const key = activityDateKey(day)
    const entry = byDay.get(key) ?? { count: 0, correct: 0 }
    entry.count += 1
    if (attempt.correct) entry.correct += 1
    byDay.set(key, entry)
  }

  const days: ActivityDay[] = []
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const date = addDays(start, index)
    const key = activityDateKey(date)
    const entry = byDay.get(key)
    days.push({
      date,
      key,
      row: index % DAYS_PER_WEEK,
      column: Math.floor(index / DAYS_PER_WEEK),
      count: entry?.count ?? 0,
      correct: entry?.correct ?? 0,
      level: activityLevelOf(entry?.count ?? 0),
      future: date.getTime() > anchor.getTime(),
    })
  }

  const total = days.reduce((sum, day) => sum + day.count, 0)
  const correct = days.reduce((sum, day) => sum + day.correct, 0)
  let longestStreak = 0
  let currentStreak = 0
  for (const day of days) {
    if (day.count > 0) {
      currentStreak += 1
      longestStreak = Math.max(longestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  return {
    anchor,
    start,
    end,
    days,
    monthLabels: monthLabelsOf(days),
    total,
    correct,
    accuracy: total === 0 ? 0 : Math.round((correct / total) * 100),
    longestStreak,
  }
}

export interface ActivityHeatmapProps {
  readonly attempts: readonly StudentAttempt[]
  /** Injectable clock for deterministic tests; defaults to the browser clock. */
  readonly now?: Date | number | string
}

const dayLabelOf = (day: ActivityDay): string => {
  if (day.future) return `${day.key} · 未来日期`
  return `${day.key} · 当天 ${day.count} 次练习 · 正确 ${day.correct}`
}

/** Annual learning activity card used at the top of the record surface. */
export function ActivityHeatmap({ attempts, now }: ActivityHeatmapProps) {
  const anchor = useMemo(() => parseDate(now), [now])
  const [yearOffset, setYearOffset] = useState<0 | 1>(0)
  const selectedAnchor = useMemo(
    () => (yearOffset === 0 ? anchor : addYearsClamped(anchor, -1)),
    [anchor, yearOffset],
  )
  const calendar = useMemo(
    () => buildActivityCalendar(attempts, selectedAnchor),
    [attempts, selectedAnchor],
  )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const defaultFocusIndex = useMemo(() => {
    for (let index = calendar.days.length - 1; index >= 0; index -= 1) {
      const day = calendar.days[index]
      if (day !== undefined && !day.future) return index
    }
    return 0
  }, [calendar])
  const focusedIndex = Math.max(
    0,
    calendar.days.findIndex(day => day.key === focusKey),
  )
  const activeIndex = calendar.days[focusedIndex]?.key === focusKey
    ? focusedIndex
    : defaultFocusIndex
  const years = [anchor.getFullYear(), anchor.getFullYear() - 1] as const

  const moveFocus = (nextIndex: number) => {
    const next = calendar.days[Math.max(0, Math.min(calendar.days.length - 1, nextIndex))]
    if (next === undefined) return
    setFocusKey(next.key)
    queueMicrotask(() => {
      document
        .querySelector<HTMLElement>(`[data-activity-date="${next.key}"]`)
        ?.focus()
    })
  }

  const onCellKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
    }
    const delta = moves[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      moveFocus(index + delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveFocus(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveFocus(calendar.days.length - 1)
    }
  }

  return (
    <section className={css.root} data-physicsos-activity-heatmap>
      <header className={css.header}>
        <div>
          <h2 className={css.heading}>
            过去一年完成 <strong className={css.count}>{calendar.total}</strong> 次练习
          </h2>
          <p className={css.subheading}>
            正确率 {calendar.total === 0 ? '—' : `${calendar.accuracy}%`} · 最长连续 {calendar.longestStreak} 天
          </p>
        </div>
        <div className={css.yearSwitch} role="group" aria-label="统计年份">
          {years.map((year, index) => (
            <button
              key={year}
              type="button"
              className={css.yearButton}
              data-active={yearOffset === index ? 'true' : 'false'}
              aria-pressed={yearOffset === index}
              onClick={() => {
                setYearOffset(index as 0 | 1)
                setFocusKey(null)
              }}
            >
              {year}
            </button>
          ))}
        </div>
      </header>

      <div className={css.scroller}>
        <div className={css.calendar}>
          <div className={css.monthRow} aria-hidden="true">
            {calendar.monthLabels.map(month => (
              <span
                key={`${month.column}-${month.label}`}
                className={css.monthLabel}
                style={{ left: `${month.column * 13}px` }}
              >
                {month.label}
              </span>
            ))}
          </div>
          <div className={css.gridRow}>
            <div className={css.weekdays} aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index} className={css.weekdayLabel}>{label}</span>
              ))}
            </div>
            <div className={css.grid} role="grid" aria-label="过去一年学习活动">
              {Array.from({ length: WEEKS }, (_, column) => (
                <div className={css.weekColumn} role="row" key={column}>
                  {calendar.days
                    .slice(column * DAYS_PER_WEEK, (column + 1) * DAYS_PER_WEEK)
                    .map((day) => {
                      const index = column * DAYS_PER_WEEK + day.row
                      return (
                        <span
                          key={day.key}
                          role="gridcell"
                          className={css.cell}
                          data-activity-cell
                          data-activity-date={day.key}
                          data-col={day.column}
                          data-row={day.row}
                          data-level={day.level}
                          data-future={day.future ? 'true' : undefined}
                          tabIndex={index === activeIndex ? 0 : -1}
                          aria-label={dayLabelOf(day)}
                          title={dayLabelOf(day)}
                          onFocus={() => { setFocusKey(day.key) }}
                          onKeyDown={(event) => { onCellKeyDown(event, index) }}
                        />
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={css.legend} aria-label="练习次数由少到多">
        <span>少</span>
        {[0, 1, 2, 3, 4].map(level => (
          <span key={level} className={css.legendCell} data-level={level} aria-hidden="true" />
        ))}
        <span>多</span>
      </div>
    </section>
  )
}
