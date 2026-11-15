// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { LabStudySection, type LabStudySectionProps } from '../src/client/LabStudySection.tsx'
import { PhysicsSurface } from '../src/client/LabWorkspace.tsx'
import { ExperimentPicker } from '../src/client/ExperimentPicker.tsx'
import { zh } from '../src/client/locales.ts'
import { createPaperApi, type AnnotationRow, type SourcePaperRow } from '../src/client/paper-api.ts'
import { buildLibraryItems } from '../src/client/physics/library-curriculum.ts'

const translations: Readonly<Record<string, string>> = zh
const t: TranslateNS<'physicsos'> = key => translations[key] ?? key
const paper = (over: Partial<SourcePaperRow> = {}): SourcePaperRow => ({
  id: 'p1', year: 2025, level: 'zhongkao', subject: 'physics',
  examName: '2025 贵阳中考物理真题', evidenceTier: 'original-scan',
  sourceRef: 'archive/2025-gz', enteredBy: 'entry',
  status: 'verified', enteredAt: '2026-09-01T00:00:00Z', totalScore: 90, minutes: 90,
  ...over,
})
const note = (over: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: 'p1-1', sourcePaperId: 'p1', questionNo: '1', subject: 'physics',
  kind: 'choice-single', score: 3, knowledgePrimary: '参照物',
  knowledgeSecondary: [], ability: '理解', answerSource: 'manual-transcript',
  reviewer: 'entry', status: 'verified', ...over,
})
const stubApi = (sources: SourcePaperRow[], annotations: AnnotationRow[]) => ({
  listSources: vi.fn().mockResolvedValue(sources),
  listAnnotations: vi.fn().mockResolvedValue(annotations),
}) satisfies NonNullable<LabStudySectionProps['paperApi']>
const openPapers = (api: NonNullable<LabStudySectionProps['paperApi']>) => {
  render(<LabStudySection t={t} paperApi={api} />)
  fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
}
const chooseStage = (label: string, option: string): void => {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('inline study inside the experiment centre', () => {
  it('starts compact and requests no paper data until expanded, then fetches only the selected paper questions', async () => {
    const api = stubApi([paper()], [note({ stem: '选择题题干' })])
    const view = render(<LabStudySection t={t} paperApi={api} />)
    expect(screen.getByRole('button', { name: zh['lab.study.practice.title'] }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: zh['lab.study.papers.title'] }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(api.listSources).not.toHaveBeenCalled()
    expect(api.listAnnotations).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-physicsos-surface="library"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
    const card = (await screen.findByText(paper().examName)).closest('[data-paper-id]') as HTMLElement
    expect(api.listSources).toHaveBeenCalledOnce()
    expect(api.listAnnotations).not.toHaveBeenCalled()
    fireEvent.click(within(card).getByRole('button', { name: zh['library.paper.expand'] }))
    await screen.findByText('选择题题干')
    expect(api.listAnnotations).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
    expect(screen.queryByText('选择题题干')?.closest('[hidden]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
    expect(screen.getByText('选择题题干')).toBeTruthy()
    expect(api.listSources).toHaveBeenCalledOnce()
    expect(api.listAnnotations).toHaveBeenCalledOnce()
  })

  it('mounts both study actions in the real Lab dispatcher for students, never the inaccessible teacher studio', async () => {
    const api = stubApi([paper()], [note({ stem: '学生可读的已核验题干' })])
    const deniedWrite = vi.fn(() => { throw new Error('student writes forbidden') })
    const paperApi = { ...createPaperApi(), ...api, addSource: deniedWrite, createJob: deniedWrite }
    const practiceQuestion = vi.fn().mockResolvedValue({ ok: true })
    const unused = (): never => { throw new Error('unused session/workspace hook') }
    render(<PhysicsSurface t={t} paperApi={paperApi} practiceQuestion={practiceQuestion}
      useAuth={selector => selector({ status: 'authed', user: { id: 'student', schoolId: 'school', schoolName: 'School',
        username: 'student', displayName: 'Student', role: 'STUDENT' } })}
      usePhysicsSurface={selector => selector({ surface: 'lab' })}
      useLearningRecord={selector => selector({ attempts: [] })}
      useRecentExperiments={selector => selector({ items: [] })}
      useSessions={unused} useWorkspaces={unused} />)
    expect(screen.getByText(zh['lab.template.empty.title'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
    const card = (await screen.findByText(paper().examName)).closest('[data-paper-id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: zh['library.paper.expand'] }))
    expect(await screen.findByText('学生可读的已核验题干')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.practice.title'] }))
    fireEvent.change(screen.getByRole('searchbox', { name: zh['lab.study.practice.search'] }), { target: { value: '01-proton-basic' } })
    fireEvent.click(screen.getByRole('button', { name: '质子垂直进入匀强磁场' }))
    fireEvent.click(screen.getByRole('button', { name: zh['library.practise'] }))
    await waitFor(() => { expect(practiceQuestion).toHaveBeenCalledWith('01-proton-basic') })
    expect(screen.queryByRole('button', { name: zh['library.papers.openStudio'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['nav.paper'] })).toBeNull()
    expect(deniedWrite).not.toHaveBeenCalled()
  })

  it('leaves the workbench add-mode experiment selector free of study sections and paper requests', () => {
    const api = stubApi([paper()], [])
    const { container } = render(<ExperimentPicker mode="add" t={t} paperApi={api} practiceQuestion={vi.fn()}
      openSurface={vi.fn()} useLearningRecord={selector => selector({ attempts: [] })}
      useRecentExperiments={selector => selector({ items: [] })} />)
    expect(screen.getByText(zh['canvas.selectExperiment'])).toBeTruthy()
    expect(container.querySelector('[data-physicsos-study]')).toBeNull()
    expect(screen.queryByRole('button', { name: zh['lab.study.practice.title'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['lab.study.papers.title'] })).toBeNull()
    expect(api.listSources).not.toHaveBeenCalled()
  })

  it('keeps complete question text and its practice identity inline rather than opening another surface', async () => {
    const practiceQuestion = vi.fn().mockResolvedValue({ ok: true })
    render(<LabStudySection t={t} practiceQuestion={practiceQuestion} />)
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.practice.title'] }))
    expect(document.querySelectorAll('[data-question-id]').length).toBe(6)
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.more'] }))
    expect(document.querySelectorAll('[data-question-id]').length).toBe(12)
    const golden = GOLDEN_QUESTIONS.find(question => question.id === '01-proton-basic')!
    const search = screen.getByRole<HTMLInputElement>('searchbox')
    fireEvent.change(search, { target: { value: golden.title } })
    fireEvent.click(screen.getByRole('button', { name: golden.title }))
    const stem = document.querySelector('[data-question-id="01-proton-basic"] p')
    expect(stem?.textContent).toBe(golden.text)
    fireEvent.click(screen.getByRole('button', { name: zh['library.practise'] }))
    await waitFor(() => { expect(practiceQuestion).toHaveBeenCalledWith(golden.id) })
    fireEvent.click(screen.getByRole('button', { name: golden.title }))
    expect(screen.queryByText(golden.text)).toBeNull()
    expect(search.value).toBe(golden.title)
  })

  it('filters practice by the existing curriculum anchors without removing business questions', () => {
    render(<LabStudySection t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.practice.title'] }))
    chooseStage(zh['lab.study.practice.stage'], zh['lab.template.stage.junior'])
    const expected = buildLibraryItems().filter(item => item.chapters.some(chapter => chapter.stage === 'junior')).slice(0, 6)
    expect([...document.querySelectorAll('[data-question-id]')].map(item => item.getAttribute('data-question-id')))
      .toEqual(expected.map(item => item.id))
    expect(screen.getByText(zh['lab.study.practice.unavailable'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['library.practise'] })).toBeNull()
  })

  it('keeps rejected tutor handovers visible, prevents duplicate submission, and allows retry', async () => {
    let finish: (value: { ok: false; error: string }) => void = () => {}
    const practiceQuestion = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockRejectedValueOnce(new Error('稍后重试'))
    render(<LabStudySection t={t} practiceQuestion={practiceQuestion} />)
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.practice.title'] }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '01-proton-basic' } })
    fireEvent.click(screen.getByRole('button', { name: '质子垂直进入匀强磁场' }))
    fireEvent.click(screen.getByRole('button', { name: zh['library.practise'] }))
    const pending = screen.getByRole<HTMLButtonElement>('button', { name: zh['library.practising'] })
    expect(pending.disabled).toBe(true)
    fireEvent.click(pending)
    expect(practiceQuestion).toHaveBeenCalledOnce()
    finish({ ok: false, error: '学习会话尚未就绪' })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '学习会话尚未就绪')
    fireEvent.click(screen.getByRole('button', { name: zh['library.practise'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('稍后重试') })
    expect(practiceQuestion).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('searchbox')).toBeTruthy()
  })
})

describe('read-only verified source-paper reading', () => {
  it('uses the existing student-readable GET routes without requesting paper jobs or writer operations', async () => {
    const requests: { url: string; method: string }[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ url, method })
      if (method !== 'GET') return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'students cannot write' } }), { status: 403 })
      if (url === '/physicsos/paper/sources') return new Response(JSON.stringify([paper()]))
      if (url === '/physicsos/paper/annotations?source=p1') return new Response(JSON.stringify([note({ stem: '允许学生只读的真题题干' })]))
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'student read not allowed' } }), { status: 403 })
    })
    openPapers(createPaperApi())
    await screen.findByText(paper().examName)
    fireEvent.click(screen.getByRole('button', { name: zh['library.paper.expand'] }))
    expect(await screen.findByText('允许学生只读的真题题干')).toBeTruthy()
    expect(requests).toEqual([
      { url: '/physicsos/paper/sources', method: 'GET' },
      { url: '/physicsos/paper/annotations?source=p1', method: 'GET' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows only verified papers, preserving evidence, region, school and type', async () => {
    openPapers(stubApi([
      paper({ region: '贵州·贵阳', school: '贵阳一中', kind: 'monthly', featured: true }),
      paper({ id: 'p2', examName: '未核验卷', status: 'pending' }),
    ], []))
    const card = (await screen.findByText(paper().examName)).closest('[data-paper-id]') as HTMLElement
    for (const label of ['月考', '含金量高', '贵州·贵阳', '贵阳一中', '原卷扫描']) expect(within(card).getByText(label)).toBeTruthy()
    expect(screen.queryByText('未核验卷')).toBeNull()
    expect(screen.queryByRole('button', { name: zh['library.papers.openStudio'] })).toBeNull()
  })

  it('sorts featured first, then newest year, and searches region/type while retaining the stage filter', async () => {
    openPapers(stubApi([
      paper({ id: 'old', examName: '2023 旧卷', year: 2023 }),
      paper({ id: 'star', examName: '2024 名校卷', year: 2024, featured: true, kind: 'monthly', region: '贵州·贵阳' }),
      paper({ id: 'new', examName: '2025 新卷', year: 2025, region: '广东·深圳', kind: 'real' }),
    ], []))
    await screen.findByText('2025 新卷')
    expect([...document.querySelectorAll('[data-paper-id]')].map(el => el.getAttribute('data-paper-id'))).toEqual(['star', 'new', 'old'])
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: '月考' } })
    expect(screen.getByText('2024 名校卷')).toBeTruthy()
    expect(screen.queryByText('2025 新卷')).toBeNull()
    fireEvent.change(search, { target: { value: '广东·深圳' } })
    expect(screen.getByText('2025 新卷')).toBeTruthy()
    expect(screen.queryByText('2024 名校卷')).toBeNull()
    chooseStage(zh['lab.study.papers.stage'], zh['lab.template.stage.senior'])
    expect(screen.getByText(zh['library.papers.filteredEmpty'])).toBeTruthy()
  })

  it('shows only the chosen paper’s verified stems in numeric question order', async () => {
    const api = stubApi([paper()], [
      note({ id: 'p1-10', questionNo: '10', stem: '第十题题干' }),
      note({ id: 'p1-2', questionNo: '2', stem: '第二题题干' }),
      note({ id: 'p1-x', questionNo: '9', stem: '未核验题干', status: 'pending' }),
      note({ id: 'other-1', sourcePaperId: 'other', stem: '另一份试卷题干' }),
    ])
    openPapers(api)
    const card = (await screen.findByText(paper().examName)).closest('[data-paper-id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: zh['library.paper.expand'] }))
    await within(card).findByText('第二题题干')
    expect(within(card).getAllByText(/题干$/).map(el => el.textContent)).toEqual(['第二题题干', '第十题题干'])
    expect(screen.queryByText('未核验题干')).toBeNull()
    expect(screen.queryByText('另一份试卷题干')).toBeNull()
    expect(api.listAnnotations).toHaveBeenCalledWith('p1')
  })

  it('distinguishes offline, empty papers, absent questions and missing stems honestly', async () => {
    render(<LabStudySection t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.papers.title'] }))
    expect(screen.getByText(zh['library.papers.offline'])).toBeTruthy()
    cleanup()
    openPapers(stubApi([], []))
    expect(await screen.findByText(zh['library.papers.empty'])).toBeTruthy()
    cleanup()
    openPapers(stubApi([paper()], []))
    const card = (await screen.findByText(paper().examName)).closest('[data-paper-id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: zh['library.paper.expand'] }))
    expect(await screen.findByText(zh['library.paper.questionsEmpty'])).toBeTruthy()
    cleanup()
    openPapers(stubApi([paper()], [note()]))
    await screen.findByText(paper().examName)
    fireEvent.click(screen.getByRole('button', { name: zh['library.paper.expand'] }))
    expect(await screen.findByText(zh['lab.study.papers.stemMissing'])).toBeTruthy()
  })

  it('reports fetch failure instead of a fake empty shelf and retries the same read operation', async () => {
    const api = stubApi([paper()], [note({ stem: '重试后题干' })])
    api.listSources.mockRejectedValueOnce(new Error('offline'))
    api.listAnnotations.mockRejectedValueOnce(new Error('offline'))
    openPapers(api)
    expect(await screen.findByText(zh['lab.study.papers.failed'])).toBeTruthy()
    expect(screen.queryByText(zh['library.papers.empty'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.retry'] }))
    await screen.findByText(paper().examName)
    fireEvent.click(screen.getByRole('button', { name: zh['library.paper.expand'] }))
    expect(await screen.findByText(zh['lab.study.papers.questionsFailed'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['lab.study.retry'] }))
    expect(await screen.findByText('重试后题干')).toBeTruthy()
    expect(api.listSources).toHaveBeenCalledTimes(2)
    expect(api.listAnnotations).toHaveBeenNthCalledWith(1, 'p1')
    expect(api.listAnnotations).toHaveBeenNthCalledWith(2, 'p1')
  })
})
