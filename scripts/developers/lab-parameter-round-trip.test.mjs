import assert from 'node:assert/strict'
import test from 'node:test'
import { assertParameterRoundTrip } from './lab-parameter-round-trip.mjs'

test('accepts the centimetre-to-SI-to-centimetre round-trip used by wave amplitude', () => {
  const submitted = 3.5
  const hostReadback = submitted * 0.01 * 100
  assert.notEqual(hostReadback, submitted)
  assert.doesNotThrow(() => assertParameterRoundTrip(hostReadback, submitted, 'wave amplitude'))
})

test('accepts exact finite values at all parameter magnitudes', () => {
  for (const value of [0, -3.5, 1e-20, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.doesNotThrow(() => assertParameterRoundTrip(value, value, 'exact parameter'))
  }
})

test('rejects unapplied edits and errors larger than floating-point round-off', () => {
  for (const [actual, expected] of [[3, 3.5], [3.5 + 1e-12, 3.5], [-3.5, 3.5], [0, 3.5]]) {
    assert.throws(() => assertParameterRoundTrip(actual, expected, 'host did not apply parameter'))
  }
})

test('does not hide small physical values behind a fixed absolute tolerance', () => {
  for (const [actual, expected] of [[2e-20, 1e-20], [1e-20, 0], [Number.MIN_VALUE, 0]]) {
    assert.throws(() => assertParameterRoundTrip(actual, expected, 'small parameter mismatch'))
  }
})

test('rejects missing, nonnumeric and nonfinite readbacks or submitted values', () => {
  for (const invalid of [undefined, null, '3.5', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => assertParameterRoundTrip(invalid, 3.5, 'invalid host parameter'))
    assert.throws(() => assertParameterRoundTrip(3.5, invalid, 'invalid submitted parameter'))
    assert.throws(() => assertParameterRoundTrip(invalid, invalid, 'invalid matching values'))
  }
})
