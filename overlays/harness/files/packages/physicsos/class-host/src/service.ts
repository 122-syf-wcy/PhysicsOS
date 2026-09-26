/**
 * Rules for the class and teaching workflow, over the class domain.
 */
import crypto from 'node:crypto'
import { z } from 'zod'

import { ClassError, atLeast, type IdentityActor } from './identity.ts'
import type {
  AssignmentRecord,
  AssignmentTarget,
  ClassRecord,
  MembershipRecord,
  SubmissionRecord,
} from './domain.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { classDomain } from './domain.ts'

export const createClassWire = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
})

export const membershipWire = z.object({
  userKey: z.string().regex(/^[A-Za-z0-9_-]{2,32}:[A-Za-z0-9_.-]{3,32}$/),
})

const assignmentTargetWire = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paper'),
    id: z.string().min(1).max(128),
  }),
  z.object({
    kind: z.literal('experiment'),
    id: z.string().min(1).max(128),
  }),
])

export const assignmentWire = z.object({
  title: z.string().min(1).max(120),
  instructions: z.string().max(4000).optional(),
  target: assignmentTargetWire,
  dueAt: z.iso.datetime({ offset: true }),
})

export const submissionWire = z.object({
  content: z.string().min(1).max(16_000),
})

export const reviewWire = z.object({
  status: z.enum(['accepted', 'returned']),
  comment: z.string().max(2000).optional(),
  score: z.number().min(0).max(100).optional(),
})

export interface SubmissionReceipt {
  readonly assignmentId: string
  readonly classId: string
  readonly studentKey: string
  readonly submittedAt: string
  readonly dueAt: string
  readonly late: boolean
  readonly status: 'submitted' | 'accepted' | 'returned'
  readonly review?: SubmissionRecord['review']
}

export interface SubmissionResult {
  readonly item: SubmissionRecord
  readonly receipt: SubmissionReceipt
}

export interface CompletionDashboard {
  readonly classId: string
  readonly totals: {
    readonly students: number
    readonly assignments: number
    readonly possibleSubmissions: number
    readonly submitted: number
    readonly reviewed: number
    readonly accepted: number
    readonly returned: number
    readonly outstanding: number
    readonly completionRate: number
  }
  readonly students: readonly {
    readonly userKey: string
    readonly submitted: number
    readonly reviewed: number
    readonly accepted: number
    readonly returned: number
    readonly outstanding: number
    readonly completionRate: number
  }[]
  readonly assignments: readonly {
    readonly id: string
    readonly title: string
    readonly dueAt: string
    readonly submitted: number
    readonly reviewed: number
    readonly outstanding: number
    readonly completionRate: number
  }[]
}

const id = (prefix: string): string => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`
const membershipId = (classId: string, userKey: string): string => `${classId}|${userKey}`
const submissionId = (classId: string, assignmentId: string, studentKey: string): string =>
  `${classId}|${assignmentId}|${studentKey}`
const normalizeUserKey = (userKey: string): string => {
  const separator = userKey.indexOf(':')
  return separator < 0
    ? userKey
    : `${userKey.slice(0, separator)}:${userKey.slice(separator + 1).toLowerCase()}`
}
const MAX_CLASS_MEMBERS = 500
const MAX_CLASS_ASSIGNMENTS = 500

export class ClassService {
  constructor(private readonly domain: Domain<typeof classDomain>) {}

  private get classes() {
    return this.domain.table('classes')
  }
  private get memberships() {
    return this.domain.table('memberships')
  }
  private get assignments() {
    return this.domain.table('assignments')
  }
  private get submissions() {
    return this.domain.table('submissions')
  }

  private classFor(actor: IdentityActor, classId: string): ClassRecord {
    const classroom = this.classes.get(classId)
    if (classroom === undefined) throw new ClassError(404, 'NOT_FOUND', '班级不存在')
    if (classroom.schoolId !== actor.schoolId) {
      throw new ClassError(403, 'FORBIDDEN', '无权访问其他学校的班级')
    }
    return classroom
  }

  private assertOwner(actor: IdentityActor, classroom: ClassRecord): void {
    if (atLeast(actor.role, 'SCHOOL_ADMIN')) return
    if (actor.role !== 'TEACHER' || classroom.ownerKey !== actor.userKey) {
      throw new ClassError(403, 'FORBIDDEN', '只有班主任或校管理员可以管理该班级')
    }
  }

  private isMember(actor: IdentityActor, classId: string): boolean {
    return this.memberships.get(membershipId(classId, actor.userKey)) !== undefined
  }

  private assertVisible(actor: IdentityActor, classroom: ClassRecord): void {
    if (
      atLeast(actor.role, 'SCHOOL_ADMIN') ||
      classroom.ownerKey === actor.userKey ||
      this.isMember(actor, classroom.id)
    )
      return
    throw new ClassError(403, 'FORBIDDEN', '无权访问该班级')
  }

  private assignmentFor(classroom: ClassRecord, assignmentId: string): AssignmentRecord {
    const assignment = this.assignments.get(assignmentId)
    if (
      assignment === undefined ||
      assignment.classId !== classroom.id ||
      assignment.schoolId !== classroom.schoolId
    )
      throw new ClassError(404, 'NOT_FOUND', '作业不存在')
    return assignment
  }

  private receiptOf(assignment: AssignmentRecord, submission: SubmissionRecord): SubmissionReceipt {
    return {
      assignmentId: assignment.id,
      classId: assignment.classId,
      studentKey: submission.studentKey,
      submittedAt: submission.submittedAt,
      dueAt: assignment.dueAt,
      late: submission.submittedAt > assignment.dueAt,
      status: submission.review?.status ?? 'submitted',
      ...(submission.review === undefined ? {} : { review: submission.review }),
    }
  }

  async createClass(actor: IdentityActor, body: unknown): Promise<ClassRecord> {
    if (!atLeast(actor.role, 'TEACHER')) {
      throw new ClassError(403, 'FORBIDDEN', '只有教师及以上角色可以创建班级')
    }
    const input = createClassWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '请填写有效的班级名称')
    const now = new Date().toISOString()
    const record: ClassRecord = {
      id: id('cls'),
      schoolId: actor.schoolId,
      name: input.data.name,
      ownerKey: actor.userKey,
      createdAt: now,
      updatedAt: now,
      ...(input.data.description === undefined ? {} : { description: input.data.description }),
    }
    await this.classes.put(record.id, record)
    return record
  }

  async addMember(actor: IdentityActor, classId: string, body: unknown): Promise<MembershipRecord> {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    const input = membershipWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '请填写有效的 userKey')
    const userKey = normalizeUserKey(input.data.userKey)
    if (!userKey.startsWith(`${classroom.schoolId}:`)) {
      throw new ClassError(400, 'BAD_REQUEST', '成员必须属于班级所在学校')
    }
    const existingMembers = [...this.memberships.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
    if (
      !existingMembers.some(row => row.userKey === userKey) &&
      existingMembers.length >= MAX_CLASS_MEMBERS
    )
      throw new ClassError(409, 'CLASS_FULL', `一个班级最多 ${MAX_CLASS_MEMBERS} 名成员`)
    const record: MembershipRecord = {
      id: membershipId(classId, userKey),
      classId,
      schoolId: classroom.schoolId,
      userKey,
      addedBy: actor.userKey,
      addedAt: new Date().toISOString(),
    }
    await this.memberships.put(record.id, record)
    return record
  }

  listMembers(actor: IdentityActor, classId: string, limit = 100): MembershipRecord[] {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    return [...this.memberships.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
      .sort((a, b) => a.userKey.localeCompare(b.userKey))
      .slice(0, limit)
  }

  async removeMember(
    actor: IdentityActor,
    classId: string,
    userKeyInput: string,
  ): Promise<MembershipRecord> {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    const userKey = normalizeUserKey(userKeyInput)
    if (!userKey.startsWith(`${classroom.schoolId}:`)) {
      throw new ClassError(400, 'BAD_REQUEST', '成员必须属于班级所在学校')
    }
    const key = membershipId(classId, userKey)
    const existing = this.memberships.get(key)
    if (existing === undefined) throw new ClassError(404, 'NOT_FOUND', '班级成员不存在')
    await this.memberships.delete(key)
    return existing
  }

  async createAssignment(
    actor: IdentityActor,
    classId: string,
    body: unknown,
  ): Promise<AssignmentRecord> {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    const input = assignmentWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '请填写有效的作业内容与截止时间')
    const existingAssignments = [...this.assignments.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
    if (existingAssignments.length >= MAX_CLASS_ASSIGNMENTS) {
      throw new ClassError(409, 'ASSIGNMENT_LIMIT', `一个班级最多 ${MAX_CLASS_ASSIGNMENTS} 项作业`)
    }
    const now = new Date().toISOString()
    const record: AssignmentRecord = {
      id: id('asg'),
      classId,
      schoolId: classroom.schoolId,
      title: input.data.title,
      target: input.data.target satisfies AssignmentTarget,
      dueAt: input.data.dueAt,
      createdBy: actor.userKey,
      createdAt: now,
      updatedAt: now,
      ...(input.data.instructions === undefined ? {} : { instructions: input.data.instructions }),
    }
    await this.assignments.put(record.id, record)
    return record
  }

  listAssignments(actor: IdentityActor, classId: string, limit = 200): AssignmentRecord[] {
    const classroom = this.classFor(actor, classId)
    this.assertVisible(actor, classroom)
    return [...this.assignments.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
  }

  async submitAssignment(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
    body: unknown,
  ): Promise<SubmissionResult> {
    if (actor.role !== 'STUDENT') {
      throw new ClassError(403, 'FORBIDDEN', '只有学生可以提交作业')
    }
    const classroom = this.classFor(actor, classId)
    if (!this.isMember(actor, classId)) {
      throw new ClassError(403, 'FORBIDDEN', '只有班级成员可以提交作业')
    }
    const assignment = this.assignmentFor(classroom, assignmentId)
    const input = submissionWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '请填写 1 至 16000 字的作业内容')
    const key = submissionId(classId, assignmentId, actor.userKey)
    const existing = this.submissions.get(key)
    const now = new Date().toISOString()
    const record: SubmissionRecord = {
      id: key,
      classId,
      assignmentId,
      schoolId: classroom.schoolId,
      studentKey: actor.userKey,
      content: input.data.content,
      submittedAt: existing?.submittedAt ?? now,
      updatedAt: now,
    }
    await this.submissions.put(record.id, record)
    return { item: record, receipt: this.receiptOf(assignment, record) }
  }

  getReceipt(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
  ): SubmissionResult | undefined {
    if (actor.role !== 'STUDENT') {
      throw new ClassError(403, 'FORBIDDEN', '只有学生可以查看自己的作业回执')
    }
    const classroom = this.classFor(actor, classId)
    if (!this.isMember(actor, classId)) {
      throw new ClassError(403, 'FORBIDDEN', '只有班级成员可以查看作业回执')
    }
    const assignment = this.assignmentFor(classroom, assignmentId)
    const submission = this.submissions.get(submissionId(classId, assignmentId, actor.userKey))
    return submission === undefined
      ? undefined
      : { item: submission, receipt: this.receiptOf(assignment, submission) }
  }

  listSubmissions(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
    limit = 500,
  ): SubmissionRecord[] {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    this.assignmentFor(classroom, assignmentId)
    return [...this.submissions.entries()]
      .map(([, row]) => row)
      .filter(
        row =>
          row.classId === classId &&
          row.assignmentId === assignmentId &&
          row.schoolId === classroom.schoolId,
      )
      .sort((a, b) => a.studentKey.localeCompare(b.studentKey))
      .slice(0, limit)
  }

  async reviewSubmission(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
    studentKey: string,
    body: unknown,
  ): Promise<SubmissionRecord> {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    this.assignmentFor(classroom, assignmentId)
    const input = reviewWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '请填写有效的批改结果')
    const normalizedKey = normalizeUserKey(studentKey)
    if (!normalizedKey.startsWith(`${classroom.schoolId}:`)) {
      throw new ClassError(400, 'BAD_REQUEST', '学生不属于班级所在学校')
    }
    const key = submissionId(classId, assignmentId, normalizedKey)
    const existing = this.submissions.get(key)
    if (existing === undefined) throw new ClassError(404, 'NOT_FOUND', '作业提交不存在')
    const updated: SubmissionRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
      review: {
        status: input.data.status,
        reviewedBy: actor.userKey,
        reviewedAt: new Date().toISOString(),
        ...(input.data.comment === undefined ? {} : { comment: input.data.comment }),
        ...(input.data.score === undefined ? {} : { score: input.data.score }),
      },
    }
    await this.submissions.put(updated.id, updated)
    return updated
  }

  dashboard(actor: IdentityActor, classId: string): CompletionDashboard {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    const members = [...this.memberships.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
      .sort((a, b) => a.userKey.localeCompare(b.userKey))
    const assignments = this.listAssignments(actor, classId, MAX_CLASS_ASSIGNMENTS)
    const submissionRows = [...this.submissions.entries()]
      .map(([, row]) => row)
      .filter(row => row.classId === classId && row.schoolId === classroom.schoolId)
    const percent = (part: number, total: number): number =>
      total === 0 ? 0 : Math.round((part / total) * 100)
    const submitted = submissionRows.length
    const reviewed = submissionRows.filter(row => row.review !== undefined).length
    const accepted = submissionRows.filter(row => row.review?.status === 'accepted').length
    const returned = submissionRows.filter(row => row.review?.status === 'returned').length
    const possibleSubmissions = members.length * assignments.length

    return {
      classId,
      totals: {
        students: members.length,
        assignments: assignments.length,
        possibleSubmissions,
        submitted,
        reviewed,
        accepted,
        returned,
        outstanding: possibleSubmissions - submitted,
        completionRate: percent(submitted, possibleSubmissions),
      },
      students: members.map((member) => {
        const mine = submissionRows.filter(row => row.studentKey === member.userKey)
        const studentReviewed = mine.filter(row => row.review !== undefined).length
        const studentSubmitted = mine.length
        return {
          userKey: member.userKey,
          submitted: studentSubmitted,
          reviewed: studentReviewed,
          accepted: mine.filter(row => row.review?.status === 'accepted').length,
          returned: mine.filter(row => row.review?.status === 'returned').length,
          outstanding: assignments.length - studentSubmitted,
          completionRate: percent(studentSubmitted, assignments.length),
        }
      }),
      assignments: assignments.map((assignment) => {
        const rows = submissionRows.filter(row => row.assignmentId === assignment.id)
        return {
          id: assignment.id,
          title: assignment.title,
          dueAt: assignment.dueAt,
          submitted: rows.length,
          reviewed: rows.filter(row => row.review !== undefined).length,
          outstanding: members.length - rows.length,
          completionRate: percent(rows.length, members.length),
        }
      }),
    }
  }

  listClasses(actor: IdentityActor, limit = 100): ClassRecord[] {
    const memberClassIds = new Set(
      [...this.memberships.entries()]
        .map(([, row]) => row)
        .filter(row => row.userKey === actor.userKey && row.schoolId === actor.schoolId)
        .map(row => row.classId),
    )
    return [...this.classes.entries()]
      .map(([, row]) => row)
      .filter(row => row.schoolId === actor.schoolId)
      .filter(
        row =>
          atLeast(actor.role, 'SCHOOL_ADMIN') ||
          row.ownerKey === actor.userKey ||
          memberClassIds.has(row.id),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }
}
