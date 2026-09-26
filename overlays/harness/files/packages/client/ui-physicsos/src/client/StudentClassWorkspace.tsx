/**
 * Student class surface: classes they belong to, due-dated assignments, and
 * the submission receipt returned by the host.
 */
import { useEffect, useState } from 'react'

import type { AssignmentRow, ClassApi, ClassRow, SubmissionReceipt } from './class-api.ts'
import {
  DEFAULT_CLASS_WORKSPACE_LABELS,
  type ClassWorkspaceLabels,
} from './class-workspace-labels.ts'
import css from './ClassWorkspace.module.css'

export interface StudentClassWorkspaceProps {
  readonly api: ClassApi
  readonly labels?: Partial<ClassWorkspaceLabels>
}

const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

const targetLabel = (target: AssignmentRow['target'], labels: ClassWorkspaceLabels): string =>
  target.kind === 'paper' ? `${labels.paper} · ${target.id}` : `${labels.experiment} · ${target.id}`

export function StudentClassWorkspace({ api, labels: overrides }: StudentClassWorkspaceProps) {
  const labels = { ...DEFAULT_CLASS_WORKSPACE_LABELS, ...overrides }
  const [classes, setClasses] = useState<readonly ClassRow[]>([])
  const [classId, setClassId] = useState('')
  const [assignments, setAssignments] = useState<readonly AssignmentRow[]>([])
  const [assignmentId, setAssignmentId] = useState('')
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    setLoading(true)
    api
      .listClasses()
      .then((result) => {
        if (!active) return
        setClasses(result.items)
        setClassId(result.items[0]?.id ?? '')
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    if (classId === '') return
    let active = true
    setAssignments([])
    setAssignmentId('')
    setReceipt(null)
    api
      .listAssignments(classId)
      .then((result) => {
        if (!active) return
        setAssignments(result.items)
        setAssignmentId(result.items[0]?.id ?? '')
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [api, classId])

  useEffect(() => {
    if (classId === '' || assignmentId === '') return
    let active = true
    setReceipt(null)
    setContent('')
    api
      .getReceipt(classId, assignmentId)
      .then((result) => {
        if (active) setReceipt(result.receipt)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [api, classId, assignmentId])

  const classroom = classes.find(item => item.id === classId)
  const selected = assignments.find(item => item.id === assignmentId)
  const submit = (): void => {
    if (classId === '' || assignmentId === '' || content.trim() === '') return
    setBusy(true)
    setError(undefined)
    api
      .submitAssignment(classId, assignmentId, content.trim())
      .then((result) => {
        setReceipt(result.receipt)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div className={css.root} data-physicsos-surface="student-classes">
      <header className={css.header}>
        <h1 className={css.title}>{labels.studentTitle}</h1>
        {classes.length > 0 && (
          <label className={css.picker}>
            <span>{labels.classPicker}</span>
            <select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value)
              }}
            >
              {classes.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {loading && <p className={css.muted}>加载中…</p>}
      {!loading && classes.length === 0 && <p className={css.muted}>{labels.noClasses}</p>}
      {error !== undefined && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}

      {classroom !== undefined && (
        <main className={css.body}>
          <section className={css.panel}>
            <h2 className={css.sectionTitle}>{classroom.name}</h2>
            {classroom.description === undefined ? null : (
              <p className={css.muted}>{classroom.description}</p>
            )}
            <h3 className={css.sectionTitle}>{labels.assignments}</h3>
            {assignments.length === 0 ? (
              <p className={css.muted}>{labels.noAssignments}</p>
            ) : (
              <ul className={css.list}>
                {assignments.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === assignmentId ? css.rowActive : css.row}
                      aria-pressed={item.id === assignmentId}
                      onClick={() => {
                        setAssignmentId(item.id)
                      }}
                    >
                      <strong>{item.title}</strong>
                      <span>{targetLabel(item.target, labels)}</span>
                      <time dateTime={item.dueAt}>
                        {labels.dueAt} {formatDateTime(item.dueAt)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selected !== undefined && (
            <section className={css.panel}>
              <h2 className={css.sectionTitle}>{selected.title}</h2>
              {selected.instructions === undefined ? null : (
                <p className={css.instructions}>{selected.instructions}</p>
              )}
              {receipt !== null && (
                <div className={css.receipt} data-receipt-status={receipt.status}>
                  <strong>
                    {receipt.status === 'accepted'
                      ? labels.accepted
                      : receipt.status === 'returned'
                        ? labels.returned
                        : labels.submitted}
                  </strong>
                  {receipt.late && <span className={css.warn}>{labels.late}</span>}
                  {receipt.review?.comment !== undefined && <p>{receipt.review.comment}</p>}
                  {receipt.review?.score !== undefined && (
                    <span>
                      {labels.score} {receipt.review.score}
                    </span>
                  )}
                </div>
              )}
              <label className={css.field}>
                <span>{labels.submissionContent}</span>
                <textarea
                  rows={8}
                  maxLength={16_000}
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value)
                  }}
                />
              </label>
              <button
                type="button"
                className={css.primary}
                disabled={busy || content.trim() === ''}
                onClick={submit}
              >
                {receipt === null ? labels.submit : labels.resubmit}
              </button>
            </section>
          )}
        </main>
      )}
    </div>
  )
}
