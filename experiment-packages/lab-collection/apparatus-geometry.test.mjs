import assert from 'node:assert/strict';
import test from 'node:test';
import { angleDegrees, localFrame, offset, interpolate, segmentPose, surfacePose, entityId, semanticNumber, diffractionFacts, pathSpan } from './src/apparatus-geometry.js';

const close = (a, b, epsilon = 1e-12) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

test('apparatus offsets and local frames preserve native z and never mutate anchors', () => {
  const origin = Object.freeze({ x: 4, y: -2, z: 3 });
  assert.deepEqual(offset(origin, 1, 2, 0.5), { x: 5, y: 0, z: 3.5 });
  const f = localFrame(origin, 90, 'deg');
  const p = f.at(2, 1, -0.5);
  close(p.x, 3); close(p.y, 0); close(p.z, 2.5);
  assert.deepEqual(f.origin, origin);
  assert.deepEqual(interpolate(origin, { x: 8, y: 2, z: 5 }, 0.5), { x: 6, y: 0, z: 4 });
});

test('degrees and radians are explicit including zero and tiny angles', () => {
  close(angleDegrees(Math.PI / 2, 'rad'), 90);
  assert.equal(angleDegrees(0, 'deg'), 0);
  assert.equal(angleDegrees(0, 'rad'), 0);
  close(angleDegrees(0.01, 'deg'), 0.01);
  close(angleDegrees(0.01, 'rad'), 0.01 * 180 / Math.PI);
  const degrees = localFrame({ x: 0, y: 0, z: 1 }, 0.01, 'deg').at(1);
  const radians = localFrame({ x: 0, y: 0, z: 1 }, 0.01, 'rad').at(1);
  assert.ok(radians.y > degrees.y * 50);
  assert.equal(angleDegrees(1, 'unknown'), undefined);
  assert.equal(angleDegrees(Number.NaN, 'deg'), undefined);
});

test('contact thickness grows below the exact surface at positive and negative slope', () => {
  for (const to of [{ x: 8, y: 3, z: 1 }, { x: 8, y: -3, z: 1 }]) {
    const from = { x: 0, y: 0, z: 1 }, thickness = 0.2, pose = surfacePose(from, to, thickness), middle = interpolate(from, to, 0.5);
    close(pose.at.x + pose.normal.x * thickness / 2, middle.x);
    close(pose.at.y + pose.normal.y * thickness / 2, middle.y);
    close(pose.at.z, 1);
  }
  assert.equal(surfacePose({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.2), undefined);
});

test('3D segment quaternion maps local positive x to the native connection axis', () => {
  for (const to of [{ x: 3, y: 4, z: 12 }, { x: -3, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }]) {
    const pose = segmentPose({ x: 0, y: 0, z: 0 }, to), q = pose.quaternion;
    const rotated = { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) };
    close(rotated.x, pose.direction.x); close(rotated.y, pose.direction.y); close(rotated.z, pose.direction.z);
    close(pose.at.x, to.x / 2); close(pose.at.y, to.y / 2); close(pose.at.z, to.z / 2);
  }
});

test('stable identity requires native entity IDs, with singular structural roles only', () => {
  assert.equal(entityId({ id: 'cart-A', tag: 'cart', index: 8 }), 'cart-A');
  assert.equal(entityId({ id: 0 }), '0');
  assert.equal(entityId({ tag: 'shared-tag', index: 3 }), undefined);
  assert.equal(entityId({}, 'one-bench'), 'one-bench');
});

test('semantic values reject formatted strings and retain zero and scientific tiny numbers', () => {
  for (const value of [0, -0, 1e-30, -1e-20, 2.4]) assert.equal(semanticNumber(value), value);
  for (const value of ['0', '0.000001 m', '1,23', '', null, undefined, Infinity, Number.NaN]) assert.equal(semanticNumber(value), undefined);
  const view = { waveDiffraction: { id: 'slit', slitAt: { x: 0, y: 2 }, screenAt: { x: 10, y: 2 }, slitWidth: 0, screenHalfHeight: 3, intensitySamples: [] } };
  assert.equal(diffractionFacts(view).slitWidth, 0);
  assert.equal(diffractionFacts({ ...view, waveDiffraction: { ...view.waveDiffraction, slitWidth: 1e-16 } }).slitWidth, 1e-16);
  assert.equal(diffractionFacts({ ...view, waveDiffraction: { ...view.waveDiffraction, slitWidth: '0.1' } }), undefined);
  assert.equal(diffractionFacts({ inspector: [{ derived: [{ id: 'slit_width', value: '0.1', unit: 'm' }] }] }), undefined);
});

test('direction marker remains on a native segment and does not cut a wire corner', () => {
  const points = Object.freeze([Object.freeze({ x: 0, y: 0, z: 1 }), Object.freeze({ x: 1, y: 0, z: 1 }), Object.freeze({ x: 1, y: 2, z: 1 })]);
  for (const fraction of [0, 0.2, 0.5, 1]) {
    const marker = pathSpan(points, fraction, 0.8);
    assert.ok(marker);
    const onHorizontal = marker.from.y === 0 && marker.to.y === 0;
    const onVertical = marker.from.x === 1 && marker.to.x === 1;
    assert.ok(onHorizontal || onVertical);
    assert.equal(marker.from.z, 1); assert.equal(marker.to.z, 1);
  }
  assert.equal(pathSpan([{ x: 0, y: 0 }, { x: 0, y: 0 }], 0.5, 1), undefined);
});
