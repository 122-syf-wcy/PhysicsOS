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

/** The studio never touches sessions or workspaces in these cases. */
const neverHook = (() => {
  throw new Error('unused hook')
}) as never
/* Only the back control is localised; everything else is Chinese-only and the
   keys pass straight through. */
const t = (key: string): string => (key === 'paper.backToHome' ? '返回首页' : key)

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
  replaceQuestion: vi.fn(),
  bankPlan: vi.fn(),
  approve: vi.fn(),
  runExport: vi.fn(),
  listExports: vi.fn().mockResolvedValue([]),
  fileUrl: vi.fn().mockReturnValue(''),
  listBankItems: vi.fn().mockResolvedValue([]),
  ingestBank: vi.fn(),
  updateBankItem: vi.fn(),
  reviewBankItem: vi.fn(),
  reviewBankItems: vi.fn(),
  triageBankItems: vi.fn(),
  ingestBankImages: vi.fn(),
})

describe('PaperWorkspace', () => {
  /* Fake-timer tests must never leak the mocked clock into their neighbours:
     a hung `findBy*` under a frozen clock aborts the test before its own
     finally, so real timers are restored here as well. */
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('renders the pipeline stepper with counts and the sources tab', async () => {
    render(<PaperWorkspace api={stubApi([job(), job({ id: 'p2', status: 'exported' })])} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    expect(screen.getByRole('button', { name: /新建试卷/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /草稿与审核/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /已定稿/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /真题资料库/ })).toBeTruthy()
    expect((await screen.findAllByText('1')).length).toBeGreaterThan(0)
  })

  it('shows the builder on one screen with the advanced fold, and the live summary', async () => {
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    /* No step rail any more: the required inputs and the fold all mount at
       once, so a teacher can create a paper without paging through a wizard. */
    expect(screen.queryByRole('button', { name: '基本信息' })).toBeNull()
    expect(await screen.findByTestId('blueprint')).toBeTruthy()
    expect(document.querySelector('[data-paper-step="basic"]')).toBeTruthy()
    expect(document.querySelector('[data-paper-step="scope"]')).toBeTruthy()
    expect(document.querySelector('[data-paper-step="advanced"]')).toBeTruthy()
    expect(screen.getByText('高级设置（卷型 · 难度 · 排除内容）')).toBeTruthy()

    /* The summary column is present and never claims a result that has not
       been computed. */
    expect(screen.getByText('试卷摘要')).toBeTruthy()
    expect(screen.getByText('待生成')).toBeTruthy()
    expect(screen.getByText('待检查')).toBeTruthy()
    expect(screen.getByText('物理验证')).toBeTruthy()
    expect(screen.getByText('考试规范校验')).toBeTruthy()
  })

  it('keeps kind, difficulty and exclusions inside the advanced fold', async () => {
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    expect(await screen.findByText('难度系数（贵州中高考标准档）')).toBeTruthy()
    expect(document.querySelector('[data-paper-step="advanced"]')).toBeTruthy()
    const seg = (label: string) => screen.getByText((_content, el) => el?.textContent === label)
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
    render(<PaperWorkspace api={stubApi([j])} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
    expect(await screen.findByText('2027 贵州省中考物理月考卷')).toBeTruthy()
    expect(screen.getByText('待审核')).toBeTruthy()
    expect(screen.getByText('1/2 题已审')).toBeTruthy()
  })

  it('opens a job detail with the stage rail marking the current phase', async () => {
    render(<PaperWorkspace api={stubApi([job()])} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
    fireEvent.click(await screen.findByText(/月考·bp-gz|paper-1|bp-gz/))
    expect(await screen.findByRole('list', { name: '任务阶段' })).toBeTruthy()
    /* 细目表不再是独立阶段——起草自动确认,stage rail 从 AI 起草开始。 */
    expect(screen.getByText('AI 起草')).toBeTruthy()
    expect(screen.getByText('逐题审核')).toBeTruthy()
    expect(screen.queryByText(/^细目表$/)).toBeNull()
  })

  it('one AI button auto-confirms the spec table, drafts, and only checks after drafting lands', async () => {
    vi.useFakeTimers()
    try {
      /* spec-stage job with a spec table: the old flow demanded a manual
         确认细目表 first; the one-button flow folds it in, and — the race the
         old client shipped — must NOT fire /check before /draft finishes.
         Synchronous queries only: a frozen fake clock never advances the
         polling inside `findBy*`. */
      const sequence: string[] = []
      const specJob = job({
        status: 'spec',
        specTable: [{
          questionNo: 1, sectionTitle: '选择题', kind: 'choice-single', score: 3,
          knowledge: ['内能'], ability: '识记', difficulty: 'basic',
        }] as never,
      })
      const api = stubApi([specJob])
      api.bankPlan = vi.fn().mockResolvedValue([])
      api.confirmSpec = vi.fn().mockImplementation(() => {
        sequence.push('confirmSpec')
        return Promise.resolve({ ...specJob, status: 'spec' })
      })
      api.runDraft = vi.fn().mockImplementation(() => {
        sequence.push('runDraft')
        return Promise.resolve({ status: 'drafting' })
      })
      api.runChecks = vi.fn().mockImplementation(() => {
        sequence.push('runChecks')
        return Promise.resolve({ status: 'checking' })
      })
      const getJob = vi.fn().mockImplementation(() => {
        /* Status schedule shared by every caller (openJob, the runner's own
           first fetch, the runner poll and the 3s backup poll): spec ×2 →
           drafting ×2 → checking ×3 → review. The wide checking band keeps
           the runChecks transition deterministic regardless of which poll
           consumes which slot. */
        const schedule = ['spec', 'spec', 'drafting', 'drafting', 'checking', 'checking', 'checking', 'review']
        const calls = getJob.mock.calls.length
        const status = schedule[calls - 1] ?? 'review'
        sequence.push(`poll:${status}`)
        return Promise.resolve({ ...specJob, status })
      })
      api.getJob = getJob
      render(<PaperWorkspace api={api} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
      await vi.advanceTimersByTimeAsync(0)
      fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
      await vi.advanceTimersByTimeAsync(0)
      fireEvent.click(screen.getByText(/bp-gz/))
      await vi.advanceTimersByTimeAsync(0)
      fireEvent.click(screen.getByRole('button', { name: /AI 起草 \+ 自动检查/ }))
      /* Flush the runner's promise chain (its own getJob → confirmSpec →
         runDraft) across microtask ticks before asserting. */
      for (let i = 0; i < 20 && !sequence.includes('runDraft'); i += 1) {
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(sequence).toEqual(['poll:spec', 'poll:spec', 'confirmSpec', 'runDraft'])
      /* Draft lands on the polls (drafting → checking); /check may only fire
         after a poll observed 'checking'. */
      for (let ms = 0; ms < 10_000; ms += 500) {
        await vi.advanceTimersByTimeAsync(500)
        if (sequence.includes('runChecks')) break
      }
      expect(sequence.indexOf('runDraft')).toBeGreaterThan(sequence.indexOf('confirmSpec'))
      const firstChecking = sequence.indexOf('poll:checking')
      expect(firstChecking).toBeGreaterThan(-1)
      expect(sequence.slice(0, firstChecking)).not.toContain('runChecks')
      expect(api.runChecks).toHaveBeenCalledTimes(1)
      /* The runner exits on the terminal poll, not earlier. */
      for (let ms = 0; ms < 10_000 && !sequence.includes('poll:review'); ms += 500) {
        await vi.advanceTimersByTimeAsync(500)
      }
      expect(sequence.includes('poll:review')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the working mascot with live progress telemetry while drafting', async () => {
    const drafting = job({
      status: 'drafting',
      progress: { stage: 'draft', detail: '起草「三、实验题」', done: 2, total: 6, updatedAt: '2026-10-05T00:00:00Z' },
    })
    render(<PaperWorkspace api={stubApi([drafting])} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /草稿与审核/ }))
    fireEvent.click(await screen.findByText(/bp-gz/))
    const status = await screen.findByRole('status')
    expect(status.getAttribute('aria-label')).toContain('AI 起草')
    expect(screen.getByText(/起草「三、实验题」（2\/6）/)).toBeTruthy()
    /* The mascot wears its mood and the phase rail marks the live phase. */
    expect(document.querySelector('[data-mood="write"]')).toBeTruthy()
    expect(screen.getByText('● AI 起草')).toBeTruthy()
  })

  it('submits region, school, kind and featured with a new source paper', async () => {
    const api = stubApi()
    render(<PaperWorkspace api={api} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
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
    render(<PaperWorkspace api={api} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
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
    render(<PaperWorkspace api={api} useAuth={useAuthAs('STUDENT')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)

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
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs()} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    expect(screen.getByText(/只有教师及以上角色/)).toBeTruthy()
  })

  it('mounts the studio for every teaching role', async () => {
    for (const role of ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const) {
      const view = render(
        <PaperWorkspace
          api={stubApi()}
          useAuth={useAuthAs(role)}
          useSessions={neverHook}
          useWorkspaces={neverHook}
          t={t}
        />,
      )
      expect(await screen.findByRole('button', { name: /新建试卷/ }), role).toBeTruthy()
      view.unmount()
    }
  })
})

/**
 * The way out.
 *
 * The studio is a full-takeover surface: without a control that leaves it the
 * only exit is the browser's history, which a screen-reader or keyboard user
 * cannot be asked to find. It calls the shell's own `openSurface`, the same
 * seat every other surface uses to return `home`.
 */
describe('PaperWorkspace back control', () => {
  afterEach(() => { cleanup() })

  it('leaves for the home surface, with a localised accessible name', () => {
    const openSurface = vi.fn()
    render(
      <PaperWorkspace
        api={stubApi()}
        useAuth={useAuthAs('TEACHER')}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        t={t}
        openSurface={openSurface}
      />,
    )
    const back = screen.getByRole('button', { name: '返回首页' })
    fireEvent.click(back)
    expect(openSurface).toHaveBeenCalledTimes(1)
    expect(openSurface).toHaveBeenCalledWith('home')
  })

  it('renders no back control when the seat is absent, and nothing harmful', () => {
    render(<PaperWorkspace api={stubApi()} useAuth={useAuthAs('TEACHER')} useSessions={neverHook} useWorkspaces={neverHook} t={t} />)
    expect(screen.queryByRole('button', { name: '返回首页' })).toBeNull()
    /* The rest of the header is untouched — the title still anchors the page. */
    expect(screen.getByRole('heading', { name: /出卷工作台/ })).toBeTruthy()
  })
})
