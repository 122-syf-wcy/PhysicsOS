/** Run in the server build container: node --experimental-transform-types packages/physicsos/class-host/tests/dashboard-benchmark.ts */
import { performance } from 'node:perf_hooks'
import { dashboardFixture } from './dashboard-fixture.ts'

const fixture = dashboardFixture(500, 500)
const timings: number[] = []
for (let sample = 0; sample < 7; sample++) {
  const started = performance.now()
  const result = fixture.service.dashboard(fixture.actor, fixture.classId)
  const elapsed = performance.now() - started
  if (result.totals.submitted !== 187_500 || result.totals.completionRate !== 75) {
    throw new Error('Dashboard benchmark correctness check failed')
  }
  if (sample >= 2) timings.push(elapsed)
}
timings.sort((left, right) => left - right)
process.stdout.write(`${JSON.stringify({
  benchmark: 'class-dashboard', students: 500, assignments: 500,
  submissions: fixture.submissionCount, samples: timings.length,
  medianMs: timings[2], minMs: timings[0], maxMs: timings[4],
})}\n`)
