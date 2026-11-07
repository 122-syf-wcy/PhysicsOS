import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { classDomain, SubmissionRecord } from '../src/domain.ts'
import type { IdentityActor } from '../src/identity.ts'
import { ClassService } from '../src/service.ts'

const at = '2026-11-01T08:00:00.000Z'

/** Deterministic class data shared by correctness, scaling, and benchmark runs. */
export const dashboardFixture = (students: number, assignments: number, trackReads = false) => {
  const tables = new Map<string, Map<string, unknown>>()
  const rows = (name: string): Map<string, unknown> => {
    let table = tables.get(name)
    if (table === undefined) { table = new Map(); tables.set(name, table) }
    return table
  }
  const domain = {
    table: (name: string) => ({
      get: (key: string) => rows(name).get(key),
      entries: () => rows(name).entries(),
      put: async (key: string, value: unknown) => { rows(name).set(key, value) },
      delete: async (key: string) => rows(name).delete(key),
    }),
  } as unknown as Domain<typeof classDomain>
  const actor: IdentityActor = {
    userKey: 'GZU:teacher', schoolId: 'GZU', username: 'teacher', role: 'TEACHER',
  }
  const classId = 'dashboard-class'
  const keyReads = { student: 0, assignment: 0 }
  rows('classes').set(classId, {
    id: classId, schoolId: actor.schoolId, name: 'Dashboard fixture',
    ownerKey: actor.userKey, createdAt: at, updatedAt: at,
  })
  const studentKey = (student: number) => `GZU:student-${String(student).padStart(3, '0')}`
  const assignmentId = (assignment: number) => `assignment-${String(assignment).padStart(3, '0')}`
  for (let student = students - 1; student >= 0; student--) {
    const userKey = studentKey(student)
    const id = `${classId}|${userKey}`
    rows('memberships').set(id, {
      id, classId, schoolId: actor.schoolId, userKey, addedBy: actor.userKey, addedAt: at,
    })
  }
  for (let assignment = assignments - 1; assignment >= 0; assignment--) {
    const id = assignmentId(assignment)
    rows('assignments').set(id, {
      id, classId, schoolId: actor.schoolId, title: `Assignment ${assignment}`,
      target: { kind: 'paper', id: 'paper-fixture' },
      dueAt: new Date(Date.parse(at) + assignment * 60_000).toISOString(),
      createdBy: actor.userKey, createdAt: at, updatedAt: at,
    })
    for (let student = students - 1; student >= 0; student--) {
      // Every four slots contain a missing, accepted, returned, and ungraded submission.
      const state = (student + assignment) % 4
      if (state === 0) continue
      const userKey = studentKey(student)
      const submission: SubmissionRecord = {
        id: `${classId}|${id}|${userKey}`, classId, assignmentId: id,
        schoolId: actor.schoolId, studentKey: userKey, content: 'Completed work',
        submittedAt: '2026-11-02T08:00:00.000Z', updatedAt: at,
        ...(state === 3 ? {} : {
          review: {
            status: state === 1 ? 'accepted' as const : 'returned' as const,
            reviewedBy: actor.userKey, reviewedAt: at,
          },
        }),
      }
      if (trackReads) {
        Object.defineProperties(submission, {
          studentKey: { enumerable: true, get: () => { keyReads.student++; return userKey } },
          assignmentId: { enumerable: true, get: () => { keyReads.assignment++; return id } },
        })
      }
      rows('submissions').set(submission.id, submission)
    }
  }
  return {
    actor, classId, domain, keyReads, studentKey, assignmentId,
    submissionCount: rows('submissions').size,
    service: new ClassService(domain),
  }
}
