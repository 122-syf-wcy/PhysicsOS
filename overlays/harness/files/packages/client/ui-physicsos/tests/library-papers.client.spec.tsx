// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LibraryWorkspace } from '../src/client/LibraryWorkspace.tsx'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'
import type { AnnotationRow, PaperApi, SourcePaperRow } from '../src/client/paper-api.ts'

const translations: Readonly<Record<string, string>> = zh
const t = ((key: PhysicsosKey) => translations[key] ?? key) as never
const useLearningRecord = ((selector: (state: { attempts: never[] }) => unknown) =>
  selector({ attempts: [] })) as never

const paper = (over: Partial<SourcePaperRow> = {}): SourcePaperRow => ({
  id: 'p1', year: 2025, level: 'zhongkao', subject: 'physics',
  examName: '2025 贵阳中考物理真题', evidenceTier: 'original-scan',
  sourceRef: 'archive/2025-gz', enteredBy: 'entry',
  status: 'verified', enteredAt: '2026-09-01T00:00:00Z',
  totalScore: 90, minutes: 90,
  ...over,
})

const note = (over: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: 'p1-1', sourcePaperId: 'p1', questionNo: '1', subject: 'physics',
  kind: 'choice-single', score: 3, knowledgePrimary: '参照物',
  knowledgeSecondary: [], ability: '理解',
  answerSource: 'manual-transcript', reviewer: 'entry', status: 'verified',
  ...over,
})

const stubApi = (sources: SourcePaperRow[], annotations: AnnotationRow[]): PaperApi => ({
  listSources: vi.fn().mockResolvedValue(sources),
  addSource: vi.fn(),
  verifySource: vi.fn(),
  listAnnotations: vi.fn().mockResolvedValue(annotations),
  addAnnotation: vi.fn(),
  reviewAnnotation: vi.fn(),
  annotationStats: vi.fn().mockResolvedValue({}),
  importCsv: vi.fn(),
  listBlueprints: vi.fn().mockResolvedValue([]),
  verifyBlueprint: vi.fn(),
  listJobs: vi.fn().mockResolvedValue([]),
  createJob: vi.fn(),
  getJob: vi.fn(),
  confirmSpec: vi.fn(),
  runDraft: vi.fn(),
  runChecks: vi.fn(),
  reviewQuestion: vi.fn(),
  repairQuestion: vi.fn(),
  approve: vi.fn(),
  runExport: vi.fn(),
  listExports: vi.fn().mockResolvedValue([]),
  fileUrl: vi.fn().mockReturnValue(''),
})

const openPapers = async (api: PaperApi) => {
  render(<LibraryWorkspace useLearningRecord={useLearningRecord} paperApi={api} t={t} />)
  fireEvent.click(screen.getByRole('tab', { name: '真题卷' }))
  await screen.findByText('最新真题与名校模拟卷，逐题考点标注；筛选后按年份与录入时间排序。')
}

describe('LibraryWorkspace 真题卷库', () => {
  afterEach(() => { cleanup() })

  it('renders badges, region and school on verified paper cards only', async () => {
    await openPapers(stubApi([
      paper({ id: 'p1', region: '贵州·贵阳', school: '贵阳一中', kind: 'monthly', featured: true }),
      paper({ id: 'p2', examName: '2024 某卷', status: 'pending' }),
    ], []))
    const card = (await screen.findByText('2025 贵阳中考物理真题')).closest('[data-paper-id]') as HTMLElement
    expect(within(card).getByText('月考')).toBeTruthy()
    expect(within(card).getByText('含金量高')).toBeTruthy()
    expect(within(card).getByText('贵州·贵阳')).toBeTruthy()
    expect(within(card).getByText('贵阳一中')).toBeTruthy()
    expect(screen.queryByText('2024 某卷')).toBeNull()
  })

  it('sorts featured first, then newest year', async () => {
    await openPapers(stubApi([
      paper({ id: 'old', examName: '2023 旧卷', year: 2023 }),
      paper({ id: 'star', examName: '2024 名校卷', year: 2024, featured: true }),
      paper({ id: 'new', examName: '2025 新卷', year: 2025 }),
    ], []))
    await screen.findByText('2025 新卷')
    const cards = document.querySelectorAll('[data-paper-id]')
    expect([...cards].map(el => el.getAttribute('data-paper-id'))).toEqual(['star', 'new', 'old'])
  })

  it('filters by paper kind and region through the rail chips', async () => {
    await openPapers(stubApi([
      paper({ id: 'p1', region: '贵州·贵阳', kind: 'monthly' }),
      paper({ id: 'p2', examName: '2025 深圳卷', region: '广东·深圳', kind: 'real', year: 2025 }),
    ], []))
    await screen.findByText('2025 深圳卷')
    fireEvent.click(screen.getByRole('button', { name: '月考' }))
    expect(screen.queryByText('2025 深圳卷')).toBeNull()
    expect(screen.getByText('2025 贵阳中考物理真题')).toBeTruthy()
    /* Filter chips are pickers, not toggles — 全部 resets the axis. */
    fireEvent.click(within(screen.getByLabelText('卷类型')).getByRole('button', { name: '全部' }))
    fireEvent.click(screen.getByRole('button', { name: '广东·深圳' }))
    expect(screen.queryByText('2025 贵阳中考物理真题')).toBeNull()
    expect(screen.getByText('2025 深圳卷')).toBeTruthy()
  })

  it('expands a card to list questions with stems, ordered by number', async () => {
    await openPapers(stubApi([paper()], [
      note({ id: 'p1-2', questionNo: '2', stem: '计算题题干' }),
      note({ id: 'p1-1', questionNo: '1', stem: '选择题题干' }),
      note({ id: 'p1-x', questionNo: '9', status: 'pending' }),
    ]))
    const card = (await screen.findByText('2025 贵阳中考物理真题')).closest('[data-paper-id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /题目清单/ }))
    const stems = within(card).getAllByText(/题干$/).map(el => el.textContent)
    expect(stems).toEqual(['选择题题干', '计算题题干'])
    expect(within(card).queryByText('9')).toBeNull()
  })

  it('shows the filtered-empty state when no paper matches', async () => {
    await openPapers(stubApi([paper({ kind: 'real' })], []))
    await screen.findByText('2025 贵阳中考物理真题')
    /* All seeded papers are 中考 — the 高中 stage tab empties the shelf. */
    fireEvent.click(screen.getByRole('tab', { name: '高中' }))
    expect(await screen.findByText('当前筛选下没有匹配的试卷。')).toBeTruthy()
  })

  it('honest states: offline without api and honest empty-questions copy', async () => {
    render(<LibraryWorkspace useLearningRecord={useLearningRecord} t={t} />)
    fireEvent.click(screen.getByRole('tab', { name: '真题卷' }))
    expect(await screen.findByText('真题服务未接入，暂时无法展示。')).toBeTruthy()
    cleanup()
    await openPapers(stubApi([paper()], []))
    const card = (await screen.findByText('2025 贵阳中考物理真题')).closest('[data-paper-id]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /题目清单/ }))
    expect(within(card).getByText('该卷尚未录入题目。')).toBeTruthy()
  })
})
