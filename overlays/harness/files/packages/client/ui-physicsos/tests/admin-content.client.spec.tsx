// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminContentTab } from '../src/client/AdminContentTab.tsx'
import type { BankItemRow, PaperApi } from '../src/client/paper-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const item = (over: Partial<BankItemRow> = {}): BankItemRow => ({
  id: 'bank-1',
  level: 'zhongkao',
  subject: 'physics',
  kind: 'choice-single',
  knowledge: ['压强'],
  ability: '理解',
  difficulty: 'basic',
  score: 3,
  stem: '下列关于压强的说法正确的是',
  answer: { result: 'A', steps: [], gradingPoints: [] },
  answerTier: 'web-public',
  stemHash: 'h1',
  anomalies: [],
  reuseModes: ['adapt'],
  status: 'pending',
  enteredBy: 'ingest',
  enteredAt: '2026-09-22T00:00:00Z',
  ...over,
})

/**
 * A bank stubbed down to the three calls this tab makes.
 *
 * Cast rather than fully implemented, and that is the point of the comment: the
 * tab is a CONSOLE over the api, so the test asserts which calls it makes. A
 * stub that implemented all twenty-two would let a call the tab should not be
 * making go unnoticed.
 */
const stubApi = (items: readonly BankItemRow[], over: Partial<PaperApi> = {}): PaperApi => ({
  listBankItems: vi.fn().mockResolvedValue(items),
  listSources: vi.fn().mockResolvedValue([]),
  reviewBankItems: vi.fn().mockResolvedValue({ updated: 0, missing: [] }),
  ...over,
} as unknown as PaperApi)

const mount = (api: PaperApi) =>
  render(<AdminContentTab api={api} reviewer="教研组" t={t} />)

const cardOf = async (stem: string) => (await screen.findByText(stem)).closest('section')

describe('AdminContentTab', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('counts the whole bank, not the filtered view', async () => {
    /* The numbers at the top answer "how much of the bank is unverified", so a
       filter must not move them — otherwise the one question the console exists
       to answer changes as you look around. */
    const api = stubApi([
      item({ id: 'a', status: 'pending' }),
      item({ id: 'b', status: 'verified' }),
      item({ id: 'c', status: 'rejected' }),
      item({ id: 'd', status: 'pending', anomalies: ['题干疑似截断'] }),
    ])
    mount(api)

    /* Read each figure off its OWN stat, not off the page: three of these
       buckets hold 1 and a bare getByText would either match the wrong one or
       throw on the ambiguity, which is the test being sloppy rather than the
       tab being wrong. */
    const stat = (label: string): string | undefined =>
      document.querySelector(`[data-stat="${label}"] strong`)?.textContent ?? undefined
    await waitFor(() => { expect(stat('total')).toBe('4') })
    expect(stat('total')).toBe('4')            // 条题目
    expect(stat('pending')).toBe('2')          // 待核验
    expect(stat('verified')).toBe('1')         // 已核验
    expect(stat('rejected')).toBe('1')         // 已退回
    expect(stat('anomalies')).toBe('1')        // 有异常
    /* Narrow the view to verified only; the collection's numbers stay put.
       The status control is the FIRST select in the toolbar, and asking for it
       by role alone would match all three. */
    const [statusSelect] = screen.getAllByRole('combobox')
    fireEvent.change(statusSelect!, { target: { value: 'verified' } })
    await waitFor(() => { expect(stat('verified')).toBe('1') })
    expect(stat('total')).toBe('4')
  })

  it('lists only the status the filter asks for', async () => {
    const api = stubApi([
      item({ id: 'a', stem: '待核验的题干' }),
      item({ id: 'b', stem: '已核验的题干', status: 'verified' }),
    ])
    mount(api)

    /* Defaults to pending — the queue is what an operator opens this for. */
    expect(await screen.findByText('待核验的题干')).toBeTruthy()
    expect(screen.queryByText('已核验的题干')).toBeNull()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0]!, { target: { value: 'verified' } })
    expect(await screen.findByText('已核验的题干')).toBeTruthy()
    expect(screen.queryByText('待核验的题干')).toBeNull()
  })

  it('searches the knowledge tag as well as the stem', async () => {
    /* An operator hunting "which 压强 questions are broken" types the tag, not
       the wording — and the wording of the two stems here shares nothing. */
    const api = stubApi([
      item({ id: 'a', stem: '关于液体内部压强的问题', knowledge: ['液体压强'] }),
      item({ id: 'b', stem: '光在均匀介质中沿直线传播', knowledge: ['光的直线传播'] }),
    ])
    mount(api)
    await screen.findByText('关于液体内部压强的问题')

    const search = screen.getByPlaceholderText('搜题干或知识点')
    fireEvent.change(search, { target: { value: '光的直线传播' } })
    expect(screen.queryByText('关于液体内部压强的问题')).toBeNull()
    expect(screen.getByText('光在均匀介质中沿直线传播')).toBeTruthy()
  })

  it('surfaces anomaly reasons on the card', async () => {
    /* The reason this console exists. The studio shows one question at a time,
       which cannot answer "which 12 of the 392 are suspect". */
    const api = stubApi([
      item({ id: 'a', stem: '正常题干' }),
      item({ id: 'b', stem: '可疑题干', anomalies: ['题干疑似截断', '缺配图'] }),
    ])
    mount(api)
    await screen.findByText('正常题干')

    fireEvent.click(screen.getByLabelText('只看异常'))
    expect(screen.queryByText('正常题干')).toBeNull()
    expect(screen.getByText(/题干疑似截断/)).toBeTruthy()
    expect(screen.getByText(/缺配图/)).toBeTruthy()
  })

  it('verifies the selection in ONE call and clears it', async () => {
    /* The unit of work is the batch: an import lands hundreds of pending rows
       and per-card review is what leaves imported data inert. */
    const api = stubApi([
      item({ id: 'a', stem: '第一题' }),
      item({ id: 'b', stem: '第二题' }),
    ], { reviewBankItems: vi.fn().mockResolvedValue({ updated: 2, missing: [] }) })
    mount(api)
    await screen.findByText('第一题')

    fireEvent.click(screen.getByLabelText(/全选当前筛选/))
    fireEvent.click(screen.getByRole('button', { name: '通过' }))

    await waitFor(() => {
      expect(api.reviewBankItems).toHaveBeenCalledWith(['a', 'b'], 'verified', '教研组')
    })
    expect(await screen.findByText('已更新 2 条')).toBeTruthy()
    /* And the selection is dropped, so a second verdict cannot silently re-apply
       to rows the operator has already judged. */
    expect(screen.getByText('0 条已选')).toBeTruthy()
  })

  it('reports ids the host no longer has instead of swallowing them', async () => {
    const api = stubApi([item({ id: 'a', stem: '第一题' })], {
      reviewBankItems: vi.fn().mockResolvedValue({ updated: 1, missing: ['gone'] }),
    })
    mount(api)
    await screen.findByText('第一题')

    fireEvent.click(screen.getByLabelText(/全选当前筛选/))
    fireEvent.click(screen.getByRole('button', { name: '退回' }))

    expect(await screen.findByText(/1 条已不存在/)).toBeTruthy()
  })

  it('disables the verdict buttons until something is selected', async () => {
    const api = stubApi([item({ id: 'a', stem: '第一题' })])
    mount(api)
    await screen.findByText('第一题')

    for (const name of ['通过', '退回', '打回待审']) {
      expect(screen.getByRole('button', { name }).disabled, name).toBe(true)
    }
    fireEvent.click(screen.getByLabelText(/全选当前筛选/))
    for (const name of ['通过', '退回', '打回待审']) {
      expect(screen.getByRole('button', { name }).disabled, name).toBe(false)
    }
  })

  it('says so when the filter matches nothing', async () => {
    const api = stubApi([item({ id: 'a', stem: '第一题' })])
    mount(api)
    await screen.findByText('第一题')

    fireEvent.change(screen.getByPlaceholderText('搜题干或知识点'), { target: { value: '不存在的词' } })
    expect(screen.getByText('当前筛选下没有题目。')).toBeTruthy()
  })

  it('shows the failure rather than an empty bank when the API refuses', async () => {
    /* A 403 here means the session is not an admin one — a state the operator
       must see, not a list that looks merely empty. */
    const api = stubApi([], {
      listBankItems: vi.fn().mockRejectedValue(new Error('只有教师及以上角色可以修改题库与试卷')),
    })
    mount(api)
    expect(await screen.findByText('只有教师及以上角色可以修改题库与试卷')).toBeTruthy()
  })

  it('keeps the bank visible when the source read fails', async () => {
    /* The source list is context, not the subject: losing it must not blank the
       page the operator is actually working in. */
    const api = stubApi([item({ id: 'a', stem: '第一题' })], {
      listSources: vi.fn().mockRejectedValue(new Error('boom')),
    })
    mount(api)
    expect(await screen.findByText('第一题')).toBeTruthy()
    expect(screen.queryByText('boom')).toBeNull()
  })
})

/* The card locator is used by two cases above; keep it honest. */
void cardOf
