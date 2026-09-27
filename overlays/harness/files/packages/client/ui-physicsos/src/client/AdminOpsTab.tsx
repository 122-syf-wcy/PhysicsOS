/**
 * 批量运维 — the jobs an operator does fifty times, not once.
 *
 * The 用户 tab creates one account at a time. A school onboarding a grade needs
 * fifty, and doing them through that form is how a rollout slips a week. This
 * tab is the batch path, plus the read-only abuse posture, and like the rest of
 * the console it adds NO backend: `createUser` / `setUserStatus` / `dashboard`
 * are the calls the other tabs already make.
 *
 * Two deliberate properties of the CSV path:
 *
 *   - It reports PER ROW. A 50-row paste where row 31 has a duplicate username
 *     must not read as "failed" — 49 accounts now exist, and the operator has
 *     to know exactly which one did not. The loop is serial for that reason.
 *   - The password column is shown back only as the row it belongs to; errors
 *     never echo the password value, so a bad paste cannot leak a credential
 *     into a screenshot of the error list.
 */
import { useCallback, useEffect, useState } from 'react'

import type { AdminApi, DashboardRow } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'
import { AdminOpsPanel } from './AdminOpsPanel.tsx'
import {
  AdminCard,
  AdminCardMeta,
  AdminCardTitle,
  AdminStats,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

export interface AdminOpsTabProps {
  readonly api: AdminApi
  readonly isSuper: boolean
  readonly t: (key: PhysicsosKey) => string
}

type CsvRole = 'STUDENT' | 'TEACHER'

interface CsvRow {
  /** 1-based line number in the pasted text, for a report that matches it. */
  readonly line: number
  readonly username: string
  readonly displayName: string
  readonly password: string
  readonly role: CsvRole
}

interface RowOutcome {
  readonly line: number
  readonly username: string
  readonly ok: boolean
  readonly message?: string
}

/**
 * Parse `username,displayName,password[,role]` rows.
 *
 * Deliberately not a CSV parser: the columns are fixed, the source is a
 * spreadsheet paste, and a real parser would silently accept column-shifted
 * input that an operator really wanted rejected. A bad row is reported with
 * its line number instead of being guessed at.
 */
const parseCsv = (text: string): { rows: CsvRow[]; errors: RowOutcome[] } => {
  const rows: CsvRow[] = []
  const errors: RowOutcome[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '') return
    /* A header row is common in a paste and is not data. */
    if (line === 1 && /username|账号|用户名/i.test(trimmed)) return
    const cells = trimmed.split(',').map(cell => cell.trim())
    /* Splitting a non-empty line always yields at least one cell, so index 0 is
       a string; the later columns are the ones that can be missing. */
    const username = cells[0] ?? ''
    const displayName = cells[1]
    const password = cells[2]
    const role = cells[3]
    if (displayName === undefined || password === undefined
      || displayName === '' || password === '') {
      errors.push({
        line, username, ok: false,
        message: displayName === undefined || password === undefined
          ? '需要 账号,姓名,密码'
          : '有空字段',
      })
      return
    }
    if (role !== undefined && role !== '' && role !== 'STUDENT' && role !== 'TEACHER') {
      errors.push({ line, username, ok: false, message: '角色只能是 STUDENT 或 TEACHER' })
      return
    }
    if (username === '') {
      errors.push({ line, username, ok: false, message: '有空字段' })
      return
    }
    rows.push({
      line, username, displayName, password,
      role: role === 'TEACHER' ? 'TEACHER' : 'STUDENT',
    })
  })
  return { rows, errors }
}

export function AdminOpsTab({ api, isSuper, t }: AdminOpsTabProps) {
  const [csv, setCsv] = useState('')
  const [schoolId, setSchoolId] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<RowOutcome[] | undefined>()
  const [data, setData] = useState<DashboardRow | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [disableList, setDisableList] = useState('')
  const [disableReport, setDisableReport] = useState<RowOutcome[] | undefined>()

  const load = useCallback(() => {
    setError(undefined)
    api.dashboard().then(setData).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [api])

  useEffect(load, [load])

  const runImport = async (): Promise<void> => {
    const parsed = parseCsv(csv)
    if (parsed.rows.length === 0) {
      /* Nothing importable — but the operator pasted SOMETHING, and "nothing
         happened" is the worst answer. Report the row-level reasons instead. */
      setReport(parsed.errors)
      return
    }
    setBusy(true)
    setReport(undefined)
    const outcomes: RowOutcome[] = [...parsed.errors]
    /* Serial, and per row: a partial import is the expected case, and the
       report has to name the row that failed rather than the batch. */
    for (const row of parsed.rows) {
      try {
        await api.createUser({
          ...(isSuper && schoolId !== '' ? { schoolId } : {}),
          username: row.username,
          displayName: row.displayName,
          password: row.password,
          role: row.role,
        })
        outcomes.push({ line: row.line, username: row.username, ok: true })
      } catch (reason: unknown) {
        outcomes.push({
          line: row.line,
          username: row.username,
          ok: false,
          /* The message comes from the host and never contains the password. */
          message: reason instanceof Error ? reason.message : String(reason),
        })
      }
    }
    outcomes.sort((a, b) => a.line - b.line)
    setReport(outcomes)
    setBusy(false)
    load()
  }

  /**
   * Batch disable, the mirror of batch create.
   *
   * One username per line, because that is what a graduation list looks like
   * after a paste. Same per-row report, same reason: 49 of 50 is the normal
   * outcome and the row that did not land is the only thing the operator
   * needs from this screen.
   */
  const runDisable = async (): Promise<void> => {
    const usernames = disableList
      .split(/\r?\n/)
      .map(line => line.trim())
      /* A paste from a spreadsheet often carries two columns; the account is
         the first cell, and trailing commas are not a failure. */
      .map(line => line.split(',')[0]?.trim() ?? '')
      .filter(line => line !== '')
    if (usernames.length === 0) return

    setBusy(true)
    setDisableReport(undefined)
    const outcomes: RowOutcome[] = []
    for (const [index, username] of usernames.entries()) {
      try {
        await api.setUserStatus(schoolId, username, 'disabled')
        outcomes.push({ line: index + 1, username, ok: true })
      } catch (reason: unknown) {
        outcomes.push({
          line: index + 1, username, ok: false,
          message: reason instanceof Error ? reason.message : String(reason),
        })
      }
    }
    setDisableReport(outcomes)
    setBusy(false)
    load()
  }

  const clearPreview = parseCsv(csv)
  const failed = report?.filter(row => !row.ok).length ?? 0
  const created = report?.filter(row => row.ok).length ?? 0

  return (
    <>
      {error !== undefined && <p className={css.error}>{error}</p>}
      {isSuper && <AdminOpsPanel api={api} t={t} />}

      <AdminCard>
        <AdminCardTitle>{t('admin.ops.import')}</AdminCardTitle>
        <AdminCardMeta>{t('admin.ops.importHint')}</AdminCardMeta>
        <div className={css.formRow}>
          {isSuper && (
            <input className={css.input} placeholder={t('admin.schools.field.id')}
              value={schoolId} onChange={(event) => { setSchoolId(event.target.value) }} />
          )}
        </div>
        <textarea
          className={css.textarea}
          rows={8}
          data-testid="ops-csv"
          value={csv}
          placeholder={'s2026001,张同学,初始密码,STUDENT\ns2026002,李同学,初始密码,STUDENT'}
          onChange={(event) => { setCsv(event.target.value) }}
        />
        <div className={css.formRow}>
          <button
            type="button" className={css.primary}
            /* Enabled as long as there is a paste to explain: all-malformed
               input still deserves the per-row reasons. */
            disabled={busy || (clearPreview.rows.length === 0 && clearPreview.errors.length === 0)}
            onClick={() => { void runImport() }}
          >
            {busy ? t('admin.loading') : t('admin.ops.importRun')}
          </button>
          <span className={css.cardMeta}>
            {t('admin.ops.importPreview')
              .replace('{rows}', String(clearPreview.rows.length))
              .replace('{bad}', String(clearPreview.errors.length))}
          </span>
        </div>
      </AdminCard>

      {report !== undefined && (
        <AdminCard testId="ops-report">
          <AdminCardTitle>
            {t('admin.ops.report')
              .replace('{ok}', String(created))
              .replace('{failed}', String(failed))}
          </AdminCardTitle>
          <div className={css.list}>
            {report.map(row => (
              <p key={row.line} className={row.ok ? css.cardMeta : css.error}>
                {t('admin.ops.line').replace('{line}', String(row.line))}
                {' '}
                <code className={css.action}>{row.username}</code>
                {' '}
                {row.ok ? t('admin.ops.rowOk') : (row.message ?? t('admin.ops.rowFailed'))}
              </p>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard>
        <AdminCardTitle>{t('admin.ops.disable')}</AdminCardTitle>
        <AdminCardMeta>{t('admin.ops.disableHint')}</AdminCardMeta>
        <textarea
          className={css.textarea}
          rows={6}
          data-testid="ops-disable"
          value={disableList}
          placeholder={'s2026001\ns2026002'}
          onChange={(event) => { setDisableList(event.target.value) }}
        />
        <div className={css.formRow}>
          <button
            type="button" className={css.primary}
            disabled={busy || disableList.trim() === ''}
            onClick={() => { void runDisable() }}
          >
            {busy ? t('admin.loading') : t('admin.ops.disableRun')}
          </button>
        </div>
      </AdminCard>

      {disableReport !== undefined && (
        <AdminCard testId="ops-disable-report">
          <AdminCardTitle>
            {t('admin.ops.report')
              .replace('{ok}', String(disableReport.filter(r => r.ok).length))
              .replace('{failed}', String(disableReport.filter(r => !r.ok).length))}
          </AdminCardTitle>
          {disableReport.map(row => (
            <p key={row.line} className={row.ok ? css.cardMeta : css.error}>
              {t('admin.ops.line').replace('{line}', String(row.line))}
              {' '}
              <code className={css.action}>{row.username}</code>
              {' '}
              {row.ok ? t('admin.ops.rowOk') : (row.message ?? t('admin.ops.rowFailed'))}
            </p>
          ))}
        </AdminCard>
      )}

      {/* Read-only, and honest about what a limiter view can be: the buckets
          live in memory, so a restart empties this and the numbers mean
          "since this process started", not "all time". */}
      <AdminCard testId="ops-limiters">
        <AdminCardTitle>{t('admin.ops.limiters')}</AdminCardTitle>
        <AdminCardMeta>{t('admin.ops.limitersHint')}</AdminCardMeta>
        {data === undefined ? (
          <AdminCardMeta>{t('admin.loading')}</AdminCardMeta>
        ) : (
          <AdminStats items={(['login', 'ip', 'apply'] as const).map(bucket => ({
            key: bucket,
            dataStat: `limiter.${bucket}`,
            value: data.limiters[bucket].saturated,
            label: (
              <>
                {t(`admin.ops.limiter.${bucket}`)}
                {' · '}
                {data.limiters[bucket].tracked}/{data.limiters[bucket].limit}
              </>
            ),
          }))} />
        )}
      </AdminCard>
    </>
  )
}
