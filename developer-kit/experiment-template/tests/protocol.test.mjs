import assert from 'node:assert/strict'
import test from 'node:test'
import { isSnapshot } from '../src/protocol.ts'

const valid = { revision: 0, source: 'preview-fixture', parameters: { objectDistanceCm: 30, objectHeightCm: 6, focalLengthCm: 10, screenDistanceCm: 15 }, visible: { image: true, rays: true }, rays: [{ points: [{ x: -30, y: 6 }, { x: 0, y: 6 }, { x: 15, y: -3 }] }], result: { imageDistanceCm: 15, imageHeightCm: -3, imageKind: 'real', screenSharp: true } }
test('accepts finite host snapshots and explicit no-image state', () => {
  assert.equal(isSnapshot(valid), true)
  assert.equal(isSnapshot({ ...valid, result: { ...valid.result, imageDistanceCm: null, imageHeightCm: null, imageKind: 'none', screenSharp: false } }), true)
})
test('rejects malformed frames rather than assigning them into Three objects', () => {
  for (const value of [null, [], {}, { ...valid, revision: -1 }, { ...valid, source: 'arbitrary' }, { ...valid, parameters: { ...valid.parameters, focalLengthCm: NaN } }, { ...valid, result: { ...valid.result, imageDistanceCm: Infinity } }]) assert.equal(isSnapshot(value), false)
})

test('rejects missing layer/height facts and malformed or excessive ray geometry', () => {
  for (const value of [
    { ...valid, parameters: { ...valid.parameters, objectHeightCm: undefined } },
    { ...valid, visible: undefined },
    { ...valid, visible: { image: 'yes', rays: true } },
    { ...valid, rays: undefined },
    { ...valid, rays: [{ points: [{ x: 0, y: NaN }, { x: 1, y: 1 }] }] },
    { ...valid, rays: [{ points: [{ x: 0, y: 0 }] }] },
    { ...valid, rays: [{ points: valid.rays[0].points, extension: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] }] },
    { ...valid, rays: Array(13).fill(valid.rays[0]) },
    { ...valid, rays: [{ points: Array(17).fill({ x: 0, y: 0 }) }] },
  ]) assert.equal(isSnapshot(value), false)
})
