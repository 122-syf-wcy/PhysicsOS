import assert from 'node:assert/strict'
import test from 'node:test'
import { isSnapshot } from '../src/protocol.ts'

const valid = { revision: 0, source: 'preview-fixture', parameters: { objectDistanceCm: 30, focalLengthCm: 10, screenDistanceCm: 15 }, result: { imageDistanceCm: 15, imageHeightCm: -3, imageKind: 'real', screenSharp: true } }
test('accepts finite host snapshots and explicit no-image state', () => {
  assert.equal(isSnapshot(valid), true)
  assert.equal(isSnapshot({ ...valid, result: { ...valid.result, imageDistanceCm: null, imageHeightCm: null, imageKind: 'none', screenSharp: false } }), true)
})
test('rejects malformed frames rather than assigning them into Three objects', () => {
  for (const value of [null, [], {}, { ...valid, revision: -1 }, { ...valid, source: 'arbitrary' }, { ...valid, parameters: { ...valid.parameters, focalLengthCm: NaN } }, { ...valid, result: { ...valid.result, imageDistanceCm: Infinity } }]) assert.equal(isSnapshot(value), false)
})
