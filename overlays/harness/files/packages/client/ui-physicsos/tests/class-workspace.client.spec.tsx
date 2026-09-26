// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StudentClassWorkspace } from '../src/client/StudentClassWorkspace.tsx'
import { TeacherClassWorkspace } from '../src/client/TeacherClassWorkspace.tsx'
import type {
  AssignmentRow,
  ClassApi,
  ClassRow,
  CompletionDashboard,
  MembershipRow,
  SubmissionRow,
} from '../src/client/class-api.ts'

const classroom = (over: Partial<ClassRow> = {}): ClassRow => ({
  id: 'cls_1',
  schoolId: 'GZU',
  name: '2026 级物理 1 班',
  description: '力学与电磁学',
  ownerKey: 'GZU:teacher',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

const assignment = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: 'asg_1',
  classId: 'cls_1',
  schoolId: 'GZU',
  title: '力学综合练习',
  instructions: '完成第一至第五题',
  target: { kind: 'paper', id: 'paper-1' },
  dueAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'GZU:teacher',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  ...over,
})

const submission = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 'sub_1',
  classId: 'cls_1',
  assignmentId: 'asg_1',
  schoolId: 'GZU',
  studentKey: 'GZU:student',
  content: '平均速度为 0.5 m/s。',
  submittedAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  ...over,
})

const dashboard = (over: Partial<CompletionDashboard> = {}): CompletionDashboard => ({
  classId: 'cls_1',
  totals: {
    students: 2,
    assignments: 2,
    possibleSubmissions: 4,
    submitted: 1,
    reviewed: 1,
    accepted: 1,
    returned: 0,
    outstanding: 3,
    completionRate: 25,
  },
  students: [
    {
      userKey: 'GZU:student',
      submitted: 1,
      reviewed: 1,
      accepted: 1,
      returned: 0,
      outstanding: 1,
      completionRate: 50,
    },
  ],
  assignments: [
    {
      id: 'asg_1',
      title: '力学综合练习',
      dueAt: '2026-10-01T12:00:00.000Z',
      submitted: 1,
      reviewed: 1,
      outstanding: 1,
      completionRate: 50,
    },
  ],
  ...over,
})

const studentApi = (over: Partial<ClassApi> = {}) => {
  const submitAssignment = vi.fn().mockResolvedValue({
    item: submission(),
    receipt: {
      assignmentId: 'asg_1',
      classId: 'cls_1',
      studentKey: 'GZU:student',
      submittedAt: '2026-09-25T00:00:00.000Z',
      dueAt: '2026-10-01T12:00:00.000Z',
      late: false,
      status: 'submitted',
    },
  })
  const api = {
    listClasses: vi.fn().mockResolvedValue({ items: [classroom()] }),
    listAssignments: vi.fn().mockResolvedValue({ items: [assignment()] }),
    getReceipt: vi.fn().mockResolvedValue({ item: null, receipt: null }),
    submitAssignment,
    ...over,
  } as unknown as ClassApi
  return { api, submitAssignment }
}

const teacherApi = (over: Partial<ClassApi> = {}) => {
  const addMember = vi.fn().mockResolvedValue({
    item: {
      id: 'cls_1|GZU:student',
      classId: 'cls_1',
      schoolId: 'GZU',
      userKey: 'GZU:student',
      addedBy: 'GZU:teacher',
      addedAt: '2026-09-25T00:00:00.000Z',
    } satisfies MembershipRow,
  })
  const createAssignment = vi.fn().mockResolvedValue({ item: assignment() })
  const reviewSubmission = vi.fn().mockResolvedValue({
    item: submission({
      review: {
        status: 'accepted',
        comment: '推导完整',
        score: 95,
        reviewedBy: 'GZU:teacher',
        reviewedAt: '2026-09-26T00:00:00.000Z',
      },
    }),
  })
  const api = {
    listClasses: vi.fn().mockResolvedValue({ items: [classroom()] }),
    createClass: vi.fn().mockResolvedValue({ item: classroom() }),
    listMembers: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'cls_1|GZU:student',
          classId: 'cls_1',
          schoolId: 'GZU',
          userKey: 'GZU:student',
          addedBy: 'GZU:teacher',
          addedAt: '2026-09-25T00:00:00.000Z',
        },
      ],
    }),
    addMember,
    removeMember: vi.fn().mockResolvedValue({ item: {} }),
    listAssignments: vi.fn().mockResolvedValue({ items: [assignment()] }),
    createAssignment,
    listSubmissions: vi.fn().mockResolvedValue({ items: [submission()] }),
    reviewSubmission,
    dashboard: vi.fn().mockResolvedValue(dashboard()),
    ...over,
  } as unknown as ClassApi
  return { api, addMember, createAssignment, reviewSubmission }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('StudentClassWorkspace', () => {
  it('opens the student class, submits work, and shows the receipt', async () => {
    const { api, submitAssignment } = studentApi()
    render(<StudentClassWorkspace api={api} />)

    expect(await screen.findByRole('heading', { name: '2026 级物理 1 班' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '力学综合练习' })).toBeTruthy()
    expect(screen.getByText(/10\/1\/2026|2026\/10\/1|10-01/)).toBeTruthy()

    const content = screen.getByLabelText('作业内容')
    const submit = screen.getByRole('button', { name: '提交作业' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(content, { target: { value: '平均速度为 0.5 m/s。' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => {
      expect(submitAssignment).toHaveBeenCalledWith('cls_1', 'asg_1', '平均速度为 0.5 m/s。')
    })
    expect(await screen.findByText('已提交')).toBeTruthy()
  })

  it('shows the teacher verdict on an existing receipt', async () => {
    const { api } = studentApi({
      getReceipt: vi.fn().mockResolvedValue({
        item: submission({
          review: {
            status: 'returned',
            comment: '请补画受力分析图',
            reviewedBy: 'GZU:teacher',
            reviewedAt: '2026-09-26T00:00:00.000Z',
          },
        }),
        receipt: {
          assignmentId: 'asg_1',
          classId: 'cls_1',
          studentKey: 'GZU:student',
          submittedAt: '2026-09-25T00:00:00.000Z',
          dueAt: '2026-10-01T12:00:00.000Z',
          late: false,
          status: 'returned',
          review: {
            status: 'returned',
            comment: '请补画受力分析图',
            reviewedBy: 'GZU:teacher',
            reviewedAt: '2026-09-26T00:00:00.000Z',
          },
        },
      }),
    })
    render(<StudentClassWorkspace api={api} />)

    expect(await screen.findByText('已退回')).toBeTruthy()
    expect(screen.getByText('请补画受力分析图')).toBeTruthy()
  })
})

describe('TeacherClassWorkspace', () => {
  it('shows completion, adds a member, and creates an assignment', async () => {
    const { api, addMember, createAssignment } = teacherApi()
    render(<TeacherClassWorkspace api={api} />)

    expect(await screen.findByText('2026 级物理 1 班', { selector: 'p' })).toBeTruthy()
    expect(await screen.findByText('25%')).toBeTruthy()
    expect(screen.getByText('GZU:student', { selector: 'code' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('学生 userKey'), {
      target: { value: 'GZU:student-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith('cls_1', 'GZU:student-2')
    })

    fireEvent.change(screen.getByLabelText('作业标题'), {
      target: { value: '磁场练习' },
    })
    fireEvent.change(screen.getByLabelText('关联类型'), {
      target: { value: 'experiment' },
    })
    fireEvent.change(screen.getByLabelText('资源 ID'), {
      target: { value: 'mechanics-average-speed' },
    })
    fireEvent.change(screen.getByLabelText('截止时间'), {
      target: { value: '2026-10-05T12:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: '布置作业' }))
    await waitFor(() => {
      expect(createAssignment).toHaveBeenCalledWith('cls_1', {
        title: '磁场练习',
        target: { kind: 'experiment', id: 'mechanics-average-speed' },
        dueAt: new Date('2026-10-05T12:00').toISOString(),
      })
    })
  })

  it('reviews a student submission', async () => {
    const { api, reviewSubmission } = teacherApi()
    render(<TeacherClassWorkspace api={api} />)

    expect(await screen.findByText('平均速度为 0.5 m/s。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('批语'), {
      target: { value: '推导完整' },
    })
    fireEvent.change(screen.getByLabelText('分数'), {
      target: { value: '95' },
    })
    fireEvent.click(screen.getByRole('button', { name: '通过' }))

    await waitFor(() => {
      expect(reviewSubmission).toHaveBeenCalledWith('cls_1', 'asg_1', 'GZU:student', {
        status: 'accepted',
        comment: '推导完整',
        score: 95,
      })
    })
  })
})
