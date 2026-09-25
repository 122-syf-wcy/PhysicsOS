// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaperWorkspace } from '../src/client/PaperWorkspace.tsx'
import type { PaperApi, PaperJobWire } from '../src/client/paper-api.ts'
import type { AuthUser } from '../src/client/auth-api.ts'
import type { AuthState } from '../src/client/auth-store.ts'

const job = (over: Partial<PaperJobWire> = {}): PaperJobWire => ({
  id: 'paper-1',
  blueprintId: 'bp-gz',
  request: {
    level: 'zhongkao', subjects: ['physics'], kind: 'monthly',
    totalScore: 90, minutes: 90, chapters: ['内能'], exclude: [],
    difficulty: { basic: 0.6, medium: 0.3, hard: 0.1 }, targetYear: 2027, textbook: '人教版',
  },
  specTable: [],
  versions: [{ version: 2, hash: 'h', at: '2026-09-17', summary: 'draft' }],
  reviews: [], findings: [], solveReport: [], repairRounds: 0,
  status: 'review',
  createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
  ...over,
})

/** A bound auth store for one role; defaults to a teacher below. */
const useAuthAs = (role?: AuthUser['role']) => {
  const state: AuthState = role === undefined
    ? { status: 'guest' }
    : {
      status: 'authed',
      user: {
        id: 'u-spec', schoolId: 'sch-spec', schoolName: '规格中学',
        username: 'spec', displayName: '规格用户', role,
      },
    }
  return function boundAuth<T>(selector: (snapshot: AuthState) => T): T { return selector(state) }
}

const stubApi = (jobs: PaperJobWire[] = []): PaperApi => ({
  listSources: vi.fn().mockResolvedValue([]),
  addSource: vi.fn(),
  verifySource: vi.fn(),
  listAnnotations: vi.fn().mockResolvedValue([]),
  addAnnotation: vi.fn(),
  reviewAnnotation: vi.fn(),
  annotationStats: vi.fn().mockResolvedValue({}),
  importCsv: vi.fn(),
  listBlueprints: vi.fn().mockResolvedValue([]),
  verifyBlueprint: vi.fn(),
  listJobs: vi.fn().mockResolvedValue(jobs),
  createJob: vi.fn(),
  getJob: vi.fn().mockImplementation((id: string) => Promise.resolve(jobs.find(j => j.id === id))),
  confirmSpec: vi.fn(),
  runDraft: vi.fn(),
  runChecks: vi.fn(),
  reviewQuestion: vi.fn(),
  repairQuestion: vi.fn(),
  approve: vi.fn(),
  runExport: vi.fn(),
  listExports: vi.fn().mockResolvedValue([]),
  fileUrl: vi.fn().mockReturnValue(''),
  listBankItems: vi.fn().mockResolvedValue([]),
  ingestBank: vi.fn(),
  updateBankItem: vi.fn(),
  reviewBankItem: vi.fn(),
})

describe('PaperWorkspace', () => {
  afterEach(() => { cleanup() })

  it('renders the pipeline stepper with counts and the sources tab', async () => {
    render(<PaperWorkspace api={stubApi([job(), job({ id: 'p2', status: 'exported' })])} useAuth={useAuthAs('TEACHER')} />)
    expect(screen.getByRole('button', { name: /新建试卷/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /草稿与审核/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /已定稿/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /真题资料库/ })).toBeTruthy()
    expect((await screen.findAllByText('1')).length).toBeGreaterThan(0)
  })

  it('shows the three-step wizard and summary card on the new-paper tab', async () => {
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs('TEACHER')} />)
    expect(await screen.findByText('选择试卷结构')).toBeTruthy()
    expect(screen.getByText('划定考试范围')).toBeTruthy()
    expect(screen.getByText('设定难度配比')).toBeTruthy()
    expect(screen.getByText('试卷摘要')).toBeTruthy()
    const seg = (t: string) => screen.getByText(
      (_content, el) => el?.textContent === t,
    )
    expect(seg('基础 55%')).toBeTruthy()
    expect(seg('中档 35%')).toBeTruthy()
    expect(seg('提高 10%')).toBeTruthy()
  })

  it('lists draft jobs with title, status and review progress', async () => {
    const j = job({
      document: {
        id: 'doc-1', title: '2027 贵州省中考物理月考卷',
        header: { examName: '月考', grade: '九年级', subjectLine: '物理', totalScore: 90, minutes: 90, candidateFields: [] },
        sections: [{ title: '选择题', items: [
          { number: 1, subject: 'physics', kind: 'choice-single', score: 3, stem: 's1', status: 'approved' },
          { number: 2, subject: 'physics', kind: 'choice-single', score: 3, stem: 's2', status: 'pending' },
        ] as never }],
      },
    })
    render(<PaperWorkspace api={stubApi([j])} useAuth={useAuthAs('TEACHER')} />)
    fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
    expect(await screen.findByText('2027 贵州省中考物理月考卷')).toBeTruthy()
    expect(screen.getByText('待审核')).toBeTruthy()
    expect(screen.getByText('1/2 题已审')).toBeTruthy()
  })

  it('opens a job detail with the stage rail marking the current phase', async () => {
    render(<PaperWorkspace api={stubApi([job()])} useAuth={useAuthAs('TEACHER')} />)
    fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
    fireEvent.click(await screen.findByText(/月考·bp-gz|paper-1|bp-gz/))
    expect(await screen.findByRole('list', { name: '任务阶段' })).toBeTruthy()
    expect(screen.getByText('细目表')).toBeTruthy()
    expect(screen.getByText('逐题审核')).toBeTruthy()
  })

  it('submits region, school, kind and featured with a new source paper', async () => {
    const api = stubApi()
    render(<PaperWorkspace api={api} useAuth={useAuthAs('TEACHER')} />)
    fireEvent.click(screen.getByRole('button', { name: /真题资料库/ }))
    fireEvent.change(screen.getByPlaceholderText('如 2025-gz-jh-lz'), { target: { value: 'p-guiyang' } })
    fireEvent.change(screen.getByPlaceholderText('如 2025 年贵州省中考理综卷'), { target: { value: '贵阳一中九月月考' } })
    fireEvent.change(screen.getByLabelText('出处 / 存档位置'), { target: { value: 'archive/guiyang' } })
    fireEvent.change(screen.getByPlaceholderText('如 贵州·贵阳（省级留空）'), { target: { value: '贵州·贵阳' } })
    fireEvent.change(screen.getByPlaceholderText('如 贵阳一中（统考留空）'), { target: { value: '贵阳一中' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '保存原卷' }))
    await vi.waitFor(() => { expect(api.addSource).toHaveBeenCalled() })
    const input = vi.mocked(api.addSource).mock.calls[0]![0]
    expect(input).toMatchObject({
      id: 'p-guiyang', region: '贵州·贵阳', school: '贵阳一中', kind: 'real', featured: true,
    })
  })

  it('requires a stem before saving a question annotation', async () => {
    const api = stubApi()
    render(<PaperWorkspace api={api} useAuth={useAuthAs('TEACHER')} />)
    fireEvent.click(screen.getByRole('button', { name: /真题资料库/ }))
    const annoCard = screen.getByText('逐题考点录入').parentElement as HTMLElement
    fireEvent.click(within(annoCard).getByRole('button', { name: '保存考点' }))
    /* No paper selected yet — the source gate fires before the stem check. */
    expect(await screen.findByText('请先选择原卷')).toBeTruthy()
    expect(api.addAnnotation).not.toHaveBeenCalled()
  })
})

/**
 * The role gate on the surface itself.
 *
 * The host refuses a student's writes on every route (`paper-host/src/identity.ts`),
 * but a workspace that mounts and then fails button by button is a worse answer
 * than one that explains itself — and its effects would still fetch the source
 * papers and the bank to say nothing. The gate is a separate component from the
 * studio for exactly that reason, so these cases pin the studio NOT mounting.
 */
describe('PaperWorkspace role gate', () => {
  afterEach(() => { cleanup() })

  it('tells a student this is a teacher surface, without mounting the studio', () => {
    const api = stubApi()
    render(<PaperWorkspace api={api} useAuth={useAuthAs('STUDENT')} />)

    expect(screen.getByText(/只有教师及以上角色/)).toBeTruthy()
    /* The studio's tabs are absent, and so is every request it would have made:
       the fetch is what would leak the bank to someone who cannot use it. */
    expect(screen.queryByRole('button', { name: /新建试卷/ })).toBeNull()
    expect(api.listSources).not.toHaveBeenCalled()
    expect(api.listJobs).not.toHaveBeenCalled()
  })

  it('says the same thing to a session that has not resolved yet', () => {
    /* `undefined` is the loading answer as well as the guest one — a reload
       paints the gate before /me returns. Showing the studio optimistically and
       then yanking it away is the flicker the AuthGate exists to avoid. */
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs()} />)
    expect(screen.getByText(/只有教师及以上角色/)).toBeTruthy()
  })

  it('mounts the studio for every teaching role', async () => {
    for (const role of ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const) {
      const view = render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs(role)} />)
      expect(await screen.findByRole('button', { name: /新建试卷/ }), role).toBeTruthy()
      view.unmount()
    }
  })
})
