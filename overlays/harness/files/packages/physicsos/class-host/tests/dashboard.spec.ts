import { describe, expect, it } from 'vitest'
import { dashboardFixture } from './dashboard-fixture.ts'

describe('class completion dashboard', () => {
  it('keeps missing, ungraded, accepted, and returned work in the correct totals and order', async () => {
    const fixture = dashboardFixture(4, 4)
    const { actor, classId, domain, service, studentKey, assignmentId } = fixture
    const stored = domain.table('submissions').get(`${classId}|${assignmentId(0)}|${studentKey(1)}`)!
    // Even a foreign-school row with the same class id must not enter any tally.
    await domain.table('submissions').put('foreign-school', { ...stored, id: 'foreign-school', schoolId: 'GZNU' })
    await domain.table('submissions').put('foreign-class', { ...stored, id: 'foreign-class', classId: 'another-class' })
    const result = service.dashboard(actor, classId)
    expect(result.totals).toEqual({
      students: 4, assignments: 4, possibleSubmissions: 16,
      submitted: 12, reviewed: 8, accepted: 4, returned: 4,
      outstanding: 4, completionRate: 75,
    })
    expect(result.students).toEqual([0, 1, 2, 3].map(student => ({
      userKey: studentKey(student), submitted: 3, reviewed: 2, accepted: 1, returned: 1,
      outstanding: 1, completionRate: 75,
    })))
    expect(result.assignments.map(({ id, submitted, reviewed, outstanding, completionRate }) => ({
      id, submitted, reviewed, outstanding, completionRate,
    }))).toEqual([0, 1, 2, 3].map(assignment => ({
      id: assignmentId(assignment), submitted: 3, reviewed: 2, outstanding: 1, completionRate: 75,
    })))
    const student = { ...actor, userKey: studentKey(1), username: 'student-001', role: 'STUDENT' as const }
    expect(service.getReceipt(student, classId, assignmentId(0))?.receipt).toMatchObject({
      late: true, status: 'accepted',
    })
  })

  it('keeps historical submissions after a member leaves and handles empty classes', async () => {
    const { actor, classId, service, studentKey } = dashboardFixture(4, 4)
    await service.removeMember(actor, classId, studentKey(0))
    const result = service.dashboard(actor, classId)
    expect(result.totals).toMatchObject({
      students: 3, possibleSubmissions: 12, submitted: 12, reviewed: 8,
      accepted: 4, returned: 4, outstanding: 0, completionRate: 100,
    })
    expect(result.students.map(row => row.userKey)).toEqual([studentKey(1), studentKey(2), studentKey(3)])
    expect(result.assignments[0]).toMatchObject({ submitted: 3, outstanding: 0, completionRate: 100 })
    const empty = dashboardFixture(0, 0)
    expect(empty.service.dashboard(empty.actor, empty.classId)).toEqual({
      classId: empty.classId,
      totals: {
        students: 0, assignments: 0, possibleSubmissions: 0, submitted: 0, reviewed: 0,
        accepted: 0, returned: 0, outstanding: 0, completionRate: 0,
      },
      students: [], assignments: [],
    })
  })

  it('bounds submission inspection when a class has 500 students and 100 assignments', () => {
    const { actor, classId, service, keyReads, submissionCount } = dashboardFixture(500, 100, true)
    const result = service.dashboard(actor, classId)
    expect(result.totals).toEqual({
      students: 500, assignments: 100, possibleSubmissions: 50_000,
      submitted: 37_500, reviewed: 25_000, accepted: 12_500, returned: 12_500,
      outstanding: 12_500, completionRate: 75,
    })
    // A data-size budget catches repeated per-student/per-assignment scans without timing flakiness.
    expect(keyReads.student + keyReads.assignment).toBeLessThanOrEqual(submissionCount * 6)
  })
})
