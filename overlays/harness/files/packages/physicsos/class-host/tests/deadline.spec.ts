import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardFixture } from './dashboard-fixture.ts'

const submittedAt = '2026-11-12T01:00:00.000Z'
const deadlines = [
  { dueAt: '2026-11-12T08:00:00+08:00', late: true },
  { dueAt: '2026-11-12T00:00:00-08:00', late: false },
  { dueAt: '2026-11-12T09:00:00+08:00', late: false },
  { dueAt: '2026-11-12T01:00:00Z', late: false },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(submittedAt))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('class assignment deadlines', () => {
  it.each(deadlines)('evaluates a new $dueAt deadline by its instant', async ({ dueAt, late }) => {
    const { actor, classId, service, studentKey } = dashboardFixture(2, 0)
    const assignment = await service.createAssignment(actor, classId, {
      title: 'Offset deadline',
      target: { kind: 'paper', id: 'paper-fixture' },
      dueAt,
    })
    const student = { ...actor, userKey: studentKey(1), username: 'student-001', role: 'STUDENT' as const }
    const result = await service.submitAssignment(student, classId, assignment.id, { content: 'Completed work' })
    expect(result.receipt).toMatchObject({ submittedAt, late })
  })

  it.each(deadlines)('evaluates a stored $dueAt deadline without rewriting historical rows', async ({ dueAt, late }) => {
    const { actor, classId, domain, service, studentKey, assignmentId } = dashboardFixture(2, 1)
    const assignments = domain.table('assignments')
    const assignment = assignments.get(assignmentId(0))!
    await assignments.put(assignment.id, { ...assignment, dueAt })
    const submissions = domain.table('submissions')
    const submission = submissions.get(`${classId}|${assignment.id}|${studentKey(1)}`)!
    await submissions.put(submission.id, { ...submission, submittedAt })

    const student = { ...actor, userKey: studentKey(1), username: 'student-001', role: 'STUDENT' as const }
    expect(service.getReceipt(student, classId, assignment.id)?.receipt).toMatchObject({ dueAt, submittedAt, late })
    expect(assignments.get(assignment.id)?.dueAt).toBe(dueAt)
  })

  it('sorts historical mixed-offset deadlines in chronological order', async () => {
    const { actor, classId, domain, service, assignmentId } = dashboardFixture(0, 3)
    const assignments = domain.table('assignments')
    const dueAtByAssignment = [
      '2026-11-12T08:00:00+08:00', // 00:00 UTC
      '2026-11-12T01:00:00Z', // 01:00 UTC
      '2026-11-11T18:00:00-08:00', // 02:00 UTC
    ]
    for (const [index, dueAt] of dueAtByAssignment.entries()) {
      const assignment = assignments.get(assignmentId(index))!
      await assignments.put(assignment.id, { ...assignment, dueAt })
    }

    expect(service.listAssignments(actor, classId).map(row => row.id)).toEqual([
      assignmentId(0), assignmentId(1), assignmentId(2),
    ])
  })
})
