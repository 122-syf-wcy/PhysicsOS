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
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  answerPolicy: z.enum(['never', 'after-due', 'after-review']).optional(),
})

export const assignmentPublicationWire = z.object({
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  retired: z.boolean().optional(),
  answerPolicy: z.enum(['never', 'after-due', 'after-review']).optional(),
}).strict().refine(value => Object.keys(value).length > 0)

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
  readonly revision: number
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

export interface SubmissionMutation { readonly baseRevision: number; readonly mutationId: string }
export interface StudentAssignmentGrant {
  readonly assignment: AssignmentRecord
  readonly answerPolicy: { readonly mode: 'never' | 'after-due' | 'after-review'; readonly released: boolean }
}

export class ClassService {
  private readonly queues = new Map<string, Promise<void>>()
  constructor(private readonly domain: Domain<typeof classDomain>) {}

  private serial<T>(actor: IdentityActor, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([actor.schoolId, actor.userKey])
    const result = (this.queues.get(key) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => {}, () => {})
    this.queues.set(key, settled)
    void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key) })
    return result
  }
  private assertActive(actor: IdentityActor): void {
    const fence = this.domain.table('erased_accounts').get(actor.userKey)
    if (fence !== undefined && fence.schoolId === actor.schoolId && (!fence.complete || actor.userId === undefined || actor.userId === fence.userId)) throw new ClassError(410, 'ACCOUNT_ERASED', '账户已删除或正在删除')
  }

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
    this.assertActive(actor)
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
    const row = this.memberships.get(membershipId(classId, actor.userKey))
    return row !== undefined && row.classId === classId && row.userKey === actor.userKey && row.schoolId === actor.schoolId
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
      revision: submission.revision ?? 1,
      submittedAt: submission.submittedAt,
      dueAt: assignment.dueAt,
      late: Date.parse(submission.submittedAt) > Date.parse(assignment.dueAt),
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
      publishedAt: input.data.publishedAt ?? now,
      answerPolicy: input.data.answerPolicy ?? 'never',
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
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit)
  }

  private published(assignment: AssignmentRecord): boolean {
    const at = Date.parse(assignment.publishedAt ?? assignment.createdAt)
    return assignment.retiredAt === undefined && Number.isFinite(at) && at <= Date.now()
  }

  /** A paper reader must obtain this grant anew, rather than accepting target/tenant fields from a device. */
  assignmentForStudent(actor: IdentityActor, classId: string, assignmentId: string): StudentAssignmentGrant {
    if (actor.role !== 'STUDENT') throw new ClassError(403, 'STUDENT_REQUIRED', '仅学生可读取作业目标')
    const classroom = this.classFor(actor, classId)
    if (!this.isMember(actor, classId)) throw new ClassError(403, 'FORBIDDEN', '仅班级成员可读取作业')
    const assignment = this.assignmentFor(classroom, assignmentId)
    if (!this.published(assignment)) throw new ClassError(404, 'NOT_FOUND', '作业未发布或已撤回')
    const mode = assignment.answerPolicy ?? 'never'
    const submitted = this.submissions.get(submissionId(classId, assignmentId, actor.userKey))
    const released = mode === 'after-due' ? Date.now() >= Date.parse(assignment.dueAt)
      : mode === 'after-review' && submitted?.schoolId === actor.schoolId && submitted.studentKey === actor.userKey && submitted.review?.status === 'accepted'
    return { assignment, answerPolicy: { mode, released } }
  }

  studentClasses(actor: IdentityActor): ClassRecord[] {
    if (actor.role !== 'STUDENT') throw new ClassError(403, 'STUDENT_REQUIRED', '仅学生可读取本人班级')
    this.assertActive(actor)
    return this.listClasses(actor, Number.MAX_SAFE_INTEGER).filter(row => this.isMember(actor, row.id))
  }

  studentAssignments(actor: IdentityActor, classId: string): AssignmentRecord[] {
    if (actor.role !== 'STUDENT') throw new ClassError(403, 'STUDENT_REQUIRED', '仅学生可读取本人作业')
    this.classFor(actor, classId)
    if (!this.isMember(actor, classId)) throw new ClassError(403, 'FORBIDDEN', '仅班级成员可读取作业')
    return this.listAssignments(actor, classId, MAX_CLASS_ASSIGNMENTS).filter(row => this.published(row))
  }

  async setAssignmentPublication(actor: IdentityActor, classId: string, assignmentId: string, body: unknown): Promise<AssignmentRecord> {
    const classroom = this.classFor(actor, classId)
    this.assertOwner(actor, classroom)
    this.assignmentFor(classroom, assignmentId)
    const input = assignmentPublicationWire.safeParse(body)
    if (!input.success) throw new ClassError(400, 'BAD_REQUEST', '发布或答案规则无效')
    return this.assignments.update(assignmentId, current => ({ ...current,
      ...(input.data.publishedAt === undefined ? {} : { publishedAt: input.data.publishedAt }),
      ...(input.data.answerPolicy === undefined ? {} : { answerPolicy: input.data.answerPolicy }),
      ...(input.data.retired === undefined ? {} : { retiredAt: input.data.retired ? new Date().toISOString() : undefined }),
      updatedAt: new Date().toISOString(),
    }))
  }

  submitAssignment(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
    body: unknown,
    mutation?: SubmissionMutation,
  ): Promise<SubmissionResult & { replayed: boolean; appliedRevision: number }> {
    return this.serial(actor, async () => {
      const { assignment } = this.assignmentForStudent(actor, classId, assignmentId)
      const input = submissionWire.safeParse(body)
      if (!input.success || Buffer.byteLength(JSON.stringify(input.data)) > 64 * 1024) throw new ClassError(400, 'BAD_REQUEST', '请填写 1 至 16000 字的作业内容')
      const key = submissionId(classId, assignmentId, actor.userKey)
      const existing = this.submissions.get(key)
      if (existing !== undefined && (existing.studentKey !== actor.userKey || existing.schoolId !== actor.schoolId)) throw new ClassError(404, 'NOT_FOUND', '提交不存在')
      const currentRevision = existing === undefined ? 0 : existing.revision ?? 1
      if (mutation !== undefined && (!Number.isSafeInteger(mutation.baseRevision) || mutation.baseRevision < 0 || !/^[A-Za-z0-9._:-]{1,128}$/.test(mutation.mutationId))) throw new ClassError(400, 'BAD_REQUEST', 'baseRevision 或幂等键无效')
      const hash = crypto.createHash('sha256').update(JSON.stringify([classId, assignmentId, input.data.content, mutation?.baseRevision])).digest('hex')
      const prior = mutation === undefined ? undefined : existing?.mutations?.find(value => value.id === mutation.mutationId)
      const current = existing === undefined ? null : { ...this.receiptOf(assignment, existing), content: existing.content }
      if (prior !== undefined && existing !== undefined) {
        if (prior.hash !== hash) throw new ClassError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同提交', { currentRevision, current })
        return { item: existing, receipt: this.receiptOf(assignment, existing), replayed: true, appliedRevision: prior.revision }
      }
      if (mutation !== undefined && mutation.baseRevision !== currentRevision) throw new ClassError(409, 'VERSION_CONFLICT', '提交或教师反馈已更新，请先读取当前回执', { currentRevision, current })
      if (mutation === undefined && existing?.content === input.data.content) return { item: existing, receipt: this.receiptOf(assignment, existing), replayed: true, appliedRevision: currentRevision }
      const revision = currentRevision + 1
      if (!Number.isSafeInteger(revision)) throw new ClassError(409, 'REVISION_EXHAUSTED', '提交版本已达上限')
      const at = new Date().toISOString()
      const record: SubmissionRecord = {
        id: key, classId, assignmentId, schoolId: actor.schoolId, studentKey: actor.userKey,
        content: input.data.content, submittedAt: existing?.submittedAt ?? at, updatedAt: at, revision,
        mutations: [...(existing?.mutations ?? []), ...(mutation === undefined ? [] : [{ id: mutation.mutationId, hash, revision }])].slice(-128),
      }
      await this.submissions.put(record.id, record)
      return { item: record, receipt: this.receiptOf(assignment, record), replayed: false, appliedRevision: revision }
    })
  }

  getReceipt(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
  ): SubmissionResult | undefined {
    if (actor.role !== 'STUDENT') {
      throw new ClassError(403, 'FORBIDDEN', '只有学生可以查看自己的作业回执')
    }
    this.classFor(actor, classId)
    if (!this.isMember(actor, classId)) {
      throw new ClassError(403, 'FORBIDDEN', '只有班级成员可以查看作业回执')
    }
    const { assignment } = this.assignmentForStudent(actor, classId, assignmentId)
    const submission = this.submissions.get(submissionId(classId, assignmentId, actor.userKey))
    return submission === undefined || submission.schoolId !== actor.schoolId || submission.studentKey !== actor.userKey
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

  reviewSubmission(actor: IdentityActor, classId: string, assignmentId: string, studentKey: string, body: unknown): Promise<SubmissionRecord> {
    const key = normalizeUserKey(studentKey)
    return this.serial({ ...actor, userKey: key }, () => this.reviewSubmissionNow(actor, classId, assignmentId, key, body))
  }

  private async reviewSubmissionNow(
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
    const revision = (existing.revision ?? 1) + 1
    if (!Number.isSafeInteger(revision)) throw new ClassError(409, 'REVISION_EXHAUSTED', '提交版本已达上限')
    const updated: SubmissionRecord = {
      ...existing,
      revision,
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
    const emptyCounts = () => ({ submitted: 0, reviewed: 0, accepted: 0, returned: 0 })
    const totals = emptyCounts()
    const byStudent = new Map<string, typeof totals>()
    const byAssignment = new Map<string, typeof totals>()
    const countsFor = (groups: Map<string, typeof totals>, key: string): typeof totals => {
      let counts = groups.get(key)
      if (counts === undefined) { counts = emptyCounts(); groups.set(key, counts) }
      return counts
    }
    const addSubmission = (counts: typeof totals, review: SubmissionRecord['review']): void => {
      counts.submitted++
      if (review !== undefined) counts.reviewed++
      if (review?.status === 'accepted') counts.accepted++
      if (review?.status === 'returned') counts.returned++
    }
    for (const [, row] of this.submissions.entries()) {
      if (row.classId !== classId || row.schoolId !== classroom.schoolId) continue
      addSubmission(totals, row.review)
      addSubmission(countsFor(byStudent, row.studentKey), row.review)
      addSubmission(countsFor(byAssignment, row.assignmentId), row.review)
    }
    const percent = (part: number, total: number): number =>
      total === 0 ? 0 : Math.round((part / total) * 100)
    const possibleSubmissions = members.length * assignments.length

    return {
      classId,
      totals: {
        students: members.length,
        assignments: assignments.length,
        possibleSubmissions,
        ...totals,
        outstanding: possibleSubmissions - totals.submitted,
        completionRate: percent(totals.submitted, possibleSubmissions),
      },
      students: members.map((member) => {
        const counts = byStudent.get(member.userKey) ?? emptyCounts()
        return {
          userKey: member.userKey,
          ...counts,
          outstanding: assignments.length - counts.submitted,
          completionRate: percent(counts.submitted, assignments.length),
        }
      }),
      assignments: assignments.map((assignment) => {
        const counts = byAssignment.get(assignment.id) ?? emptyCounts()
        return {
          id: assignment.id,
          title: assignment.title,
          dueAt: assignment.dueAt,
          submitted: counts.submitted,
          reviewed: counts.reviewed,
          outstanding: members.length - counts.submitted,
          completionRate: percent(counts.submitted, members.length),
        }
      }),
    }
  }

  exportMemberships(actor: IdentityActor): MembershipRecord[] {
    this.assertActive(actor)
    return [...this.memberships.entries()].map(([, row]) => row).filter(row => row.userKey === actor.userKey && row.schoolId === actor.schoolId)
  }

  exportSubmissions(actor: IdentityActor): SubmissionRecord[] {
    this.assertActive(actor)
    return [...this.submissions.entries()].map(([, row]) => row).filter(row => row.studentKey === actor.userKey && row.schoolId === actor.schoolId)
  }

  /** Clear only the disabled account's membership/submission rows, never a teacher's shared assignments. */
  eraseAccount(actor: IdentityActor, request: { requestId: string; userId: string; userKey: string; schoolId: string }): Promise<void> {
    return this.serial(actor, async () => {
      if (request.userKey !== actor.userKey || request.schoolId !== actor.schoolId) throw new ClassError(403, 'FORBIDDEN', '清理账户不匹配')
      const fences = this.domain.table('erased_accounts')
      const prior = fences.get(actor.userKey)
      if (prior?.requestId === request.requestId && prior.complete) return
      if (prior !== undefined && !prior.complete && prior.requestId !== request.requestId) throw new ClassError(409, 'ERASURE_CONFLICT', '其他账户清理仍在进行')
      await fences.put(actor.userKey, { ...request, complete: false })
      for (const [key, row] of this.memberships.entries()) if (row.userKey === actor.userKey && row.schoolId === actor.schoolId) await this.memberships.delete(key)
      for (const [key, row] of this.submissions.entries()) if (row.studentKey === actor.userKey && row.schoolId === actor.schoolId) await this.submissions.delete(key)
      await fences.put(actor.userKey, { ...request, complete: true })
    })
  }

  async dispose(): Promise<void> { await Promise.all([...this.queues.values()]) }

  listClasses(actor: IdentityActor, limit = 100): ClassRecord[] {
    this.assertActive(actor)
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
