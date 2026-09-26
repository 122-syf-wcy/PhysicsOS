/**
 * Teacher class console: roster, assignment publishing, per-class completion,
 * student submissions, and review.
 */
import { useEffect, useState } from 'react'

import type {
  AssignmentRow,
  ClassApi,
  ClassRow,
  CompletionDashboard,
  MembershipRow,
  SubmissionRow,
} from './class-api.ts'
import {
  DEFAULT_CLASS_WORKSPACE_LABELS,
  type ClassWorkspaceLabels,
} from './class-workspace-labels.ts'
import css from './ClassWorkspace.module.css'

export interface TeacherClassWorkspaceProps {
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

function ReviewCard({
  api,
  classId,
  assignmentId,
  row,
  labels,
}: {
  readonly api: ClassApi
  readonly classId: string
  readonly assignmentId: string
  readonly row: SubmissionRow
  readonly labels: ClassWorkspaceLabels
}) {
  const [comment, setComment] = useState(row.review?.comment ?? '')
  const [score, setScore] = useState(
    row.review?.score === undefined ? '' : String(row.review.score),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const review = (status: 'accepted' | 'returned'): void => {
    setBusy(true)
    setError(undefined)
    api
      .reviewSubmission(classId, assignmentId, row.studentKey, {
        status,
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        ...(score.trim() === '' ? {} : { score: Number(score) }),
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <article className={css.submission} data-submission={row.id}>
      <header className={css.submissionHead}>
        <strong>{row.studentKey}</strong>
        <span>
          {row.review?.status === 'accepted'
            ? labels.accepted
            : row.review?.status === 'returned'
              ? labels.returned
              : labels.pending}
        </span>
      </header>
      <p className={css.submissionBody}>{row.content}</p>
      {row.review?.comment === undefined ? null : <p className={css.muted}>{row.review.comment}</p>}
      <div className={css.reviewGrid}>
        <label className={css.field}>
          <span>{labels.reviewComment}</span>
          <input
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
            }}
          />
        </label>
        <label className={css.field}>
          <span>{labels.score}</span>
          <input
            type="number"
            min="0"
            max="100"
            value={score}
            onChange={(event) => {
              setScore(event.target.value)
            }}
          />
        </label>
      </div>
      {error !== undefined && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.actions}>
        <button
          type="button"
          className={css.primary}
          disabled={busy}
          onClick={() => {
            review('accepted')
          }}
        >
          {labels.accept}
        </button>
        <button
          type="button"
          className={css.secondary}
          disabled={busy}
          onClick={() => {
            review('returned')
          }}
        >
          {labels.returnForRevision}
        </button>
      </div>
    </article>
  )
}

export function TeacherClassWorkspace({ api, labels: overrides }: TeacherClassWorkspaceProps) {
  const labels = { ...DEFAULT_CLASS_WORKSPACE_LABELS, ...overrides }
  const [classes, setClasses] = useState<readonly ClassRow[]>([])
  const [classId, setClassId] = useState('')
  const [members, setMembers] = useState<readonly MembershipRow[]>([])
  const [assignments, setAssignments] = useState<readonly AssignmentRow[]>([])
  const [assignmentId, setAssignmentId] = useState('')
  const [submissions, setSubmissions] = useState<readonly SubmissionRow[]>([])
  const [dashboard, setDashboard] = useState<CompletionDashboard | undefined>()
  const [newClassName, setNewClassName] = useState('')
  const [memberKey, setMemberKey] = useState('')
  const [assignmentTitle, setAssignmentTitle] = useState('')
  const [targetKind, setTargetKind] = useState<'paper' | 'experiment'>('paper')
  const [targetId, setTargetId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const fail = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }

  const loadClasses = (): void => {
    api
      .listClasses()
      .then((result) => {
        setClasses(result.items)
        setClassId(current =>
          current === '' || !result.items.some(item => item.id === current)
            ? (result.items[0]?.id ?? '')
            : current,
        )
      })
      .catch(fail)
  }

  useEffect(loadClasses, [api])

  useEffect(() => {
    if (classId === '') return
    let active = true
    Promise.all([api.listMembers(classId), api.listAssignments(classId), api.dashboard(classId)])
      .then(([memberResult, assignmentResult, dashboardResult]) => {
        if (!active) return
        setMembers(memberResult.items)
        setAssignments(assignmentResult.items)
        setAssignmentId(current =>
          current === '' || !assignmentResult.items.some(item => item.id === current)
            ? (assignmentResult.items[0]?.id ?? '')
            : current,
        )
        setDashboard(dashboardResult)
      })
      .catch((cause: unknown) => {
        if (active) fail(cause)
      })
    return () => {
      active = false
    }
  }, [api, classId])

  const loadSubmissions = (): void => {
    if (classId === '' || assignmentId === '') {
      setSubmissions([])
      return
    }
    api
      .listSubmissions(classId, assignmentId)
      .then((result) => {
        setSubmissions(result.items)
      })
      .catch(fail)
  }

  useEffect(loadSubmissions, [api, classId, assignmentId])

  const createClass = (): void => {
    if (newClassName.trim() === '') return
    setBusy(true)
    setError(undefined)
    api
      .createClass({ name: newClassName.trim() })
      .then((result) => {
        setNewClassName('')
        setClassId(result.item.id)
        loadClasses()
      })
      .catch(fail)
      .finally(() => {
        setBusy(false)
      })
  }

  const addMember = (): void => {
    if (classId === '' || memberKey.trim() === '') return
    setBusy(true)
    setError(undefined)
    api
      .addMember(classId, memberKey.trim())
      .then(() => {
        setMemberKey('')
        return Promise.all([api.listMembers(classId), api.dashboard(classId)])
      })
      .then(([memberResult, dashboardResult]) => {
        setMembers(memberResult.items)
        setDashboard(dashboardResult)
      })
      .catch(fail)
      .finally(() => {
        setBusy(false)
      })
  }

  const createAssignment = (): void => {
    if (classId === '' || assignmentTitle.trim() === '' || targetId.trim() === '' || dueAt === '')
      return
    setBusy(true)
    setError(undefined)
    api
      .createAssignment(classId, {
        title: assignmentTitle.trim(),
        target: { kind: targetKind, id: targetId.trim() },
        dueAt: new Date(dueAt).toISOString(),
      })
      .then((result) => {
        setAssignmentTitle('')
        setTargetId('')
        setDueAt('')
        return Promise.all([api.listAssignments(classId), api.dashboard(classId)]).then(
          ([assignmentResult, dashboardResult]) => {
            setAssignments(assignmentResult.items)
            setAssignmentId(result.item.id)
            setDashboard(dashboardResult)
          },
        )
      })
      .catch(fail)
      .finally(() => {
        setBusy(false)
      })
  }

  const selectedClass = classes.find(item => item.id === classId)

  return (
    <div className={css.root} data-physicsos-surface="teacher-classes">
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{labels.teacherTitle}</h1>
          {selectedClass !== undefined && <p className={css.muted}>{selectedClass.name}</p>}
        </div>
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

      {error !== undefined && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}

      <section className={css.panel}>
        <h2 className={css.sectionTitle}>{labels.createClass}</h2>
        <div className={css.inlineForm}>
          <label className={css.field}>
            <span>{labels.className}</span>
            <input
              value={newClassName}
              onChange={(event) => {
                setNewClassName(event.target.value)
              }}
            />
          </label>
          <button
            type="button"
            className={css.primary}
            disabled={busy || newClassName.trim() === ''}
            onClick={createClass}
          >
            {labels.createClass}
          </button>
        </div>
      </section>

      {classId === '' ? (
        <p className={css.muted}>{labels.noClasses}</p>
      ) : (
        <main className={css.body}>
          <section className={css.panel}>
            <h2 className={css.sectionTitle}>{labels.completion}</h2>
            <div className={css.stats}>
              <div data-stat="completion">
                <strong>{dashboard?.totals.completionRate ?? 0}%</strong>
                <span>{labels.completion}</span>
              </div>
              <div data-stat="submitted">
                <strong>{dashboard?.totals.submitted ?? 0}</strong>
                <span>{labels.submittedCount}</span>
              </div>
              <div data-stat="reviewed">
                <strong>{dashboard?.totals.reviewed ?? 0}</strong>
                <span>{labels.reviewedCount}</span>
              </div>
              <div data-stat="outstanding">
                <strong>{dashboard?.totals.outstanding ?? 0}</strong>
                <span>{labels.outstandingCount}</span>
              </div>
            </div>

            <h3 className={css.sectionTitle}>{labels.members}</h3>
            <div className={css.inlineForm}>
              <label className={css.field}>
                <span>{labels.studentKey}</span>
                <input
                  value={memberKey}
                  placeholder="schoolId:username"
                  onChange={(event) => {
                    setMemberKey(event.target.value)
                  }}
                />
              </label>
              <button
                type="button"
                className={css.secondary}
                disabled={busy || memberKey.trim() === ''}
                onClick={addMember}
              >
                {labels.addMember}
              </button>
            </div>
            <ul className={css.compactList}>
              {members.map(member => (
                <li key={member.id}>
                  <code>{member.userKey}</code>
                  <button
                    type="button"
                    className={css.linkButton}
                    onClick={() => {
                      void api
                        .removeMember(classId, member.userKey)
                        .then(() => Promise.all([api.listMembers(classId), api.dashboard(classId)]))
                        .then(([memberResult, dashboardResult]) => {
                          setMembers(memberResult.items)
                          setDashboard(dashboardResult)
                        })
                        .catch(fail)
                    }}
                  >
                    {labels.removeMember}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={css.panel}>
            <h2 className={css.sectionTitle}>{labels.assignments}</h2>
            <div className={css.assignmentForm}>
              <label className={css.field}>
                <span>{labels.assignmentTitle}</span>
                <input
                  value={assignmentTitle}
                  onChange={(event) => {
                    setAssignmentTitle(event.target.value)
                  }}
                />
              </label>
              <label className={css.field}>
                <span>{labels.targetKind}</span>
                <select
                  value={targetKind}
                  onChange={(event) => {
                    setTargetKind(event.target.value as 'paper' | 'experiment')
                  }}
                >
                  <option value="paper">{labels.paper}</option>
                  <option value="experiment">{labels.experiment}</option>
                </select>
              </label>
              <label className={css.field}>
                <span>{labels.targetId}</span>
                <input
                  value={targetId}
                  onChange={(event) => {
                    setTargetId(event.target.value)
                  }}
                />
              </label>
              <label className={css.field}>
                <span>{labels.dueAt}</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => {
                    setDueAt(event.target.value)
                  }}
                />
              </label>
              <button
                type="button"
                className={css.primary}
                disabled={
                  busy || assignmentTitle.trim() === '' || targetId.trim() === '' || dueAt === ''
                }
                onClick={createAssignment}
              >
                {labels.assignAssignment}
              </button>
            </div>

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
                    <span>
                      {item.target.kind === 'paper' ? labels.paper : labels.experiment} ·{' '}
                      {item.target.id}
                    </span>
                    <time dateTime={item.dueAt}>{formatDateTime(item.dueAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={css.panel}>
            <h2 className={css.sectionTitle}>{labels.submittedCount}</h2>
            {submissions.length === 0 ? (
              <p className={css.muted}>{labels.outstandingCount}</p>
            ) : (
              submissions.map(row => (
                <ReviewCard
                  key={row.id}
                  api={api}
                  classId={classId}
                  assignmentId={assignmentId}
                  row={row}
                  labels={labels}
                />
              ))
            )}
          </section>
        </main>
      )}
    </div>
  )
}
