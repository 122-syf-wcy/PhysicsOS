/**
 * Fetch client for the class host's `/physicsos/class` REST surface.
 *
 * Same-origin calls only; the session is carried by the HttpOnly cookie. Wire
 * shapes stay structural so the browser bundle does not import host code.
 */

const BASE = '/physicsos/class'

export interface ClassRow {
  readonly id: string
  readonly schoolId: string
  readonly name: string
  readonly description?: string
  readonly ownerKey: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MembershipRow {
  readonly id: string
  readonly classId: string
  readonly schoolId: string
  readonly userKey: string
  readonly addedBy: string
  readonly addedAt: string
}

export type AssignmentTarget =
  | { readonly kind: 'paper'; readonly id: string }
  | { readonly kind: 'experiment'; readonly id: string }

export interface AssignmentRow {
  readonly id: string
  readonly classId: string
  readonly schoolId: string
  readonly title: string
  readonly instructions?: string
  readonly target: AssignmentTarget
  readonly dueAt: string
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SubmissionReview {
  readonly status: 'accepted' | 'returned'
  readonly comment?: string
  readonly score?: number
  readonly reviewedBy: string
  readonly reviewedAt: string
}

export interface SubmissionRow {
  readonly id: string
  readonly classId: string
  readonly assignmentId: string
  readonly schoolId: string
  readonly studentKey: string
  readonly content: string
  readonly submittedAt: string
  readonly updatedAt: string
  readonly review?: SubmissionReview
}

export interface SubmissionReceipt {
  readonly assignmentId: string
  readonly classId: string
  readonly studentKey: string
  readonly submittedAt: string
  readonly dueAt: string
  readonly late: boolean
  readonly status: 'submitted' | 'accepted' | 'returned'
  readonly review?: SubmissionReview
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

export class ClassApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ClassApiError'
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new ClassApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? `${response.status}`,
    )
  }
  return body as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

const put = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

const withLimit = (path: string, limit: number | undefined): string =>
  limit === undefined ? path : `${path}?limit=${limit}`

const memberPath = (classId: string, userKey: string): string =>
  `/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(userKey)}`

const assignmentBase = (classId: string, assignmentId: string): string =>
  `/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}`

export interface ClassApi {
  listClasses: (filter?: { limit?: number }) => Promise<{ items: ClassRow[] }>
  createClass: (input: { name: string; description?: string }) => Promise<{ item: ClassRow }>
  listMembers: (classId: string, filter?: { limit?: number }) => Promise<{ items: MembershipRow[] }>
  addMember: (classId: string, userKey: string) => Promise<{ item: MembershipRow }>
  removeMember: (classId: string, userKey: string) => Promise<{ item: MembershipRow }>
  listAssignments: (
    classId: string,
    filter?: { limit?: number },
  ) => Promise<{ items: AssignmentRow[] }>
  createAssignment: (
    classId: string,
    input: {
      title: string
      instructions?: string
      target: AssignmentTarget
      dueAt: string
    },
  ) => Promise<{ item: AssignmentRow }>
  submitAssignment: (
    classId: string,
    assignmentId: string,
    content: string,
  ) => Promise<{ item: SubmissionRow; receipt: SubmissionReceipt }>
  getReceipt: (
    classId: string,
    assignmentId: string,
  ) => Promise<{ item: SubmissionRow | null; receipt: SubmissionReceipt | null }>
  listSubmissions: (
    classId: string,
    assignmentId: string,
    filter?: { limit?: number },
  ) => Promise<{ items: SubmissionRow[] }>
  reviewSubmission: (
    classId: string,
    assignmentId: string,
    studentKey: string,
    input: {
      status: 'accepted' | 'returned'
      comment?: string
      score?: number
    },
  ) => Promise<{ item: SubmissionRow }>
  dashboard: (classId: string) => Promise<CompletionDashboard>
}

export function createClassApi(): ClassApi {
  return {
    listClasses: filter => request(withLimit('/classes', filter?.limit)),
    createClass: input => post('/classes', input),
    listMembers: (classId, filter) =>
      request(withLimit(`/classes/${encodeURIComponent(classId)}/members`, filter?.limit)),
    addMember: (classId, userKey) =>
      post(`/classes/${encodeURIComponent(classId)}/members`, { userKey }),
    removeMember: (classId, userKey) => request(memberPath(classId, userKey), { method: 'DELETE' }),
    listAssignments: (classId, filter) =>
      request(withLimit(`/classes/${encodeURIComponent(classId)}/assignments`, filter?.limit)),
    createAssignment: (classId, input) =>
      post(`/classes/${encodeURIComponent(classId)}/assignments`, input),
    submitAssignment: (classId, assignmentId, content) =>
      put(`${assignmentBase(classId, assignmentId)}/submission`, { content }),
    getReceipt: (classId, assignmentId) =>
      request(`${assignmentBase(classId, assignmentId)}/submission`),
    listSubmissions: (classId, assignmentId, filter) =>
      request(withLimit(`${assignmentBase(classId, assignmentId)}/submissions`, filter?.limit)),
    reviewSubmission: (classId, assignmentId, studentKey, input) =>
      post(
        `${assignmentBase(classId, assignmentId)}/submissions/${encodeURIComponent(studentKey)}/review`,
        input,
      ),
    dashboard: classId => request(`/classes/${encodeURIComponent(classId)}/dashboard`),
  }
}
