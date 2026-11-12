/** Student class operations exported without exposing teacher management or a second storage handle. */
import { z } from 'zod'
import { ClassError, type IdentityActor } from './identity.ts'
import type { AssignmentRecord, SubmissionRecord } from './domain.ts'
import type { ClassService, SubmissionResult } from './service.ts'

export const MOBILE_CLASS_SERVICE = 'physicsosMobileClasses'
export type { StudentAssignmentGrant } from './service.ts'
const student = (actor: IdentityActor): void => {
  if (actor.role !== 'STUDENT') throw new ClassError(403, 'STUDENT_REQUIRED', '仅学生可访问本人课堂数据')
}
export const mobileAssignment = (row: AssignmentRecord) => ({
  id: row.id, classId: row.classId, title: row.title, target: row.target, dueAt: row.dueAt,
  createdAt: row.createdAt, updatedAt: row.updatedAt, publishedAt: row.publishedAt ?? row.createdAt,
  answerPolicy: row.answerPolicy ?? 'never', ...(row.instructions === undefined ? {} : { instructions: row.instructions }),
})
const submissionView = (row: SubmissionRecord) => {
  const { mutations: _mutations, ...item } = row
  return { ...item, revision: row.revision ?? 1 }
}
const resultView = (result: SubmissionResult) => ({ item: submissionView(result.item), receipt: result.receipt })

export function createMobileClasses(service: ClassService) {
  return {
    listClasses(actor: IdentityActor) {
      student(actor)
      return service.studentClasses(actor).map(row => ({ id: row.id, name: row.name, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt }))
    },
    listAssignments(actor: IdentityActor, classId: string) { student(actor); return service.studentAssignments(actor, classId).map(mobileAssignment) },
    assignmentForStudent(actor: IdentityActor, classId: string, assignmentId: string) { return service.assignmentForStudent(actor, classId, assignmentId) },
    getSubmission(actor: IdentityActor, classId: string, assignmentId: string) {
      student(actor)
      const result = service.getReceipt(actor, classId, assignmentId)
      if (result === undefined) throw new ClassError(404, 'SUBMISSION_NOT_FOUND', '尚无已确认的作业提交')
      return resultView(result)
    },
    async submit(actor: IdentityActor, classId: string, assignmentId: string, body: unknown, mutationId: string) {
      student(actor)
      const parsed = z.object({ content: z.string().min(1).max(16_000), baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().safeParse(body)
      if (!parsed.success) throw new ClassError(400, 'BAD_REQUEST', '提交须包含 content 和 baseRevision（首次为 0）')
      const result = await service.submitAssignment(actor, classId, assignmentId, parsed.data, { baseRevision: parsed.data.baseRevision, mutationId })
      return { ...resultView(result), replayed: result.replayed, appliedRevision: result.appliedRevision }
    },
    exportMemberships(actor: IdentityActor) { student(actor); return service.exportMemberships(actor) },
    exportSubmissions(actor: IdentityActor) { student(actor); return service.exportSubmissions(actor).map(submissionView) },
  }
}
export type MobileClassFacade = ReturnType<typeof createMobileClasses>
