import { describe, expect, it } from 'vitest'
import { bankPlanFixture } from './bank-plan-fixture.ts'

const policy = { verbatimMax: 1, freshnessPapers: 2, exemplarCount: 2 }

describe('bank planning freshness lookups', () => {
  it('keeps recent uses scoped by school while retaining ranking, adaptation, and exemplars', async () => {
    const { domain, service, job, itemId, spec, request } = bankPlanFixture(8)
    await domain.table('jobs').put('other', job('other', 'GZNU', 'exported', '2026-11-08T08:00:00.000Z'))
    await domain.table('jobs').put('platform', job('platform', null, 'exported', '2026-11-06T08:00:00.000Z'))
    await domain.table('jobs').put('draft', job('draft', 'GZU', 'drafting', '2026-11-09T08:00:00.000Z'))
    await domain.table('bank_items').put(itemId(6), { ...service.getBankItem(itemId(6)), schoolId: 'GZNU' })
    await domain.table('bank_items').put(itemId(7), { ...service.getBankItem(itemId(7)), schoolId: 'GZU' })
    for (const [index, paperId] of [[0, 'recent'], [1, 'other'], [2, 'platform'], [3, 'old'], [4, 'draft']] as const) {
      await service.recordBankUsage(itemId(index), paperId, 'verbatim')
    }
    const plans = service.bankPlanFor(spec, request, policy, 'GZU')
    expect(plans.map(plan => ({
      item: plan.item?.id, mode: plan.mode, candidates: plan.candidates,
      exemplars: plan.exemplars.map(item => item.id),
    }))).toEqual([
      { item: itemId(1), mode: 'verbatim', candidates: 5, exemplars: [itemId(1), itemId(3)] },
      { item: itemId(3), mode: 'adapt', candidates: 4, exemplars: [itemId(3), itemId(4)] },
      { item: itemId(4), mode: 'adapt', candidates: 3, exemplars: [itemId(4), itemId(5)] },
    ])
    const allSchools = service.bankPlanFor(spec, request, { ...policy, freshnessPapers: 10 })
    expect(allSchools.map(plan => plan.item?.id)).toEqual([itemId(4), itemId(5), itemId(6)])
  })

  it('observes new usage and changed job scope on the next plan', async () => {
    const { domain, service, itemId, spec, request } = bankPlanFixture(5)
    expect(service.bankPlanFor(spec, request, policy, 'GZU')[0]?.item?.id).toBe(itemId(0))
    await service.recordBankUsage(itemId(0), 'recent', 'verbatim')
    expect(service.bankPlanFor(spec, request, policy, 'GZU')[0]?.item?.id).toBe(itemId(1))
    await domain.table('jobs').put('recent', { ...service.getJob('recent'), schoolId: 'GZNU' })
    expect(service.bankPlanFor(spec, request, policy, 'GZU')[0]?.item?.id).toBe(itemId(0))
  })

  it('reads a growing usage ledger a bounded number of times per complete plan', () => {
    const { service, work, spec, request, itemId } = bankPlanFixture(100, 2_000, 12, true)
    const plans = service.bankPlanFor(spec, request, policy, 'GZU')
    expect(plans).toHaveLength(12)
    expect(plans[0]).toMatchObject({ mode: 'verbatim', candidates: 100, item: { id: itemId(0) } })
    expect(plans[11]).toMatchObject({ mode: 'adapt', candidates: 89, item: { id: itemId(11) } })
    expect(work.usageRows).toBeLessThanOrEqual(4_000)
  })
})
