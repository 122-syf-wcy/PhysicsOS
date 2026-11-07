/** Run in the server build container: node --experimental-transform-types packages/physicsos/paper-host/tests/bank-plan-benchmark.ts */
import { performance } from 'node:perf_hooks'
import { bankPlanFixture } from './bank-plan-fixture.ts'

const fixture = bankPlanFixture(300, 5_000, 16)
const policy = { verbatimMax: 3, freshnessPapers: 2, exemplarCount: 3 }
const timings: number[] = []
for (let sample = 0; sample < 5; sample++) {
  const started = performance.now()
  const plans = fixture.service.bankPlanFor(fixture.spec, fixture.request, policy, 'GZU')
  const elapsed = performance.now() - started
  if (plans.length !== 16 || plans[15]?.item?.id !== fixture.itemId(15)) {
    throw new Error('Bank plan benchmark correctness check failed')
  }
  if (sample >= 2) timings.push(elapsed)
}
timings.sort((left, right) => left - right)
process.stdout.write(`${JSON.stringify({
  benchmark: 'paper-bank-plan', items: 300, usageRows: 5_000, questions: 16,
  samples: timings.length, medianMs: timings[1], minMs: timings[0], maxMs: timings[2],
})}\n`)
