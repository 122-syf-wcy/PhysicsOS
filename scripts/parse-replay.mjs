import { readFileSync } from 'node:fs'

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const files = [
  ['BASELINE', 'docs/reports/baseline-replay.log'],
  ['PHYSICSOS', 'docs/reports/physicsos-replay.log'],
]

const results = {}
for (const [label, path] of files) {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').map(stripAnsi)
  
  // Find lines like "FAIL  apps/web/tests/xxx.ts"
  const failFiles = new Set()
  for (const l of lines) {
    const m = l.match(/FAIL\s+(apps\/web\/tests\/\S+)/)
    if (m) failFiles.add(m[1])
  }
  
  // Find lines with "× testname"
  const failTests = new Set()
  for (const l of lines) {
    if (l.includes('× ')) {
      const m = l.match(/^\s*×\s+(.+)/)
      if (m) failTests.add(m[1].trim())
    }
  }
  
  // Find summary
  let testFiles = ''
  let tests = ''
  for (const l of lines) {
    if (l.includes('Test Files')) testFiles = l.trim()
    if (l.match(/^\s+Tests\s/)) tests = l.trim()
  }
  
  results[label] = { failFiles: [...failFiles].sort(), failTests: [...failTests].sort(), testFiles, tests }
}

// Diff
const baseline = new Set(results.BASELINE.failFiles)
const physicsos = new Set(results.PHYSICSOS.failFiles)

const a_only = [...baseline].filter(f => !physicsos.has(f))
const b_only = [...physicsos].filter(f => !baseline.has(f))
const both = [...baseline].filter(f => physicsos.has(f))

console.log('=== BASELINE ===')
console.log(results.BASELINE.testFiles)
console.log(results.BASELINE.tests)
console.log('Failed files:', results.BASELINE.failFiles.length)

console.log('\n=== PHYSICSOS ===')
console.log(results.PHYSICSOS.testFiles)
console.log(results.PHYSICSOS.tests)
console.log('Failed files:', results.PHYSICSOS.failFiles.length)

console.log('\n=== A/B DIFF ===')
console.log('A. Both fail:', both.length)
for (const f of both) console.log('  ', f)

console.log('B. Only BASELINE fails (PhysicsOS PASS):', a_only.length)
for (const f of a_only) console.log('  ', f)

console.log('C. Only PHYSICSOS fails (PHYSICSOS REGRESSION):', b_only.length)
for (const f of b_only) console.log('  ', f)
