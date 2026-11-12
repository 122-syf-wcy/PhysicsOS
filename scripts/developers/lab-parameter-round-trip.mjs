import assert from 'node:assert/strict'

/** Check the host value after applying an editable experiment parameter. */
export function assertParameterRoundTrip(actual, expected, message) {
  assert.ok(
    typeof actual === 'number' && typeof expected === 'number'
      && Number.isFinite(actual) && Number.isFinite(expected),
    message ?? 'Parameter round-trip requires finite numeric values',
  )
  // SI/display conversions can introduce a few ULPs. Compare relative error
  // without an absolute floor so tiny physical values are not treated as zero.
  const relativeError = actual === expected ? 0
    : Math.abs(actual - expected) / Math.max(Math.abs(actual), Math.abs(expected))
  assert.ok(
    relativeError <= 8 * Number.EPSILON,
    `${message ?? 'Parameter round-trip mismatch'} (expected ${expected}, received ${actual})`,
  )
}
