// Full Lab Collection verification uses the actual registry and server-compiled
// platform runtimes. No manual fixture can silently drop an experiment/domain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { drawMechanics } from './src/mechanics.js';
import { drawCircuits } from './src/circuits.js';
import { drawFields } from './src/fields.js';
import { drawOptics } from './src/optics.js';
import { drawWaves } from './src/waves.js';
import { drawMatter } from './src/matter.js';

assert.ok(process.env.PHYSICSOS_LAB_KIT_MODULE, 'Use the server-staged real Three.js 0.180.0 scene kit');
assert.ok(process.env.PHYSICSOS_LAB_RUNTIME_MODULE, 'Use the server-compiled real platform runtimes');
const { createSceneKit } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_KIT_MODULE));
const { createExperiment, snapshotOf } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_RUNTIME_MODULE));
const registry = JSON.parse(await readFile(new URL('../../overlays/harness/files/packages/physicsos/experiment-host/src/experiment-registry.json', import.meta.url), 'utf8'));
const drawers = { mechanics: drawMechanics, circuit: drawCircuits, electric: drawFields, magnetic: drawFields, composite: drawFields, induction: drawFields, optics: drawOptics, wave: drawWaves, acoustics: drawWaves, fluid: drawMatter, thermal: drawMatter, modern: drawMatter };

function draw(kit, snapshot) {
  const before = JSON.stringify(snapshot), adapter = drawers[snapshot.domain];
  assert.ok(adapter, `No adapter for ${snapshot.domain}`);
  kit.beginFrame(snapshot.view, snapshot.experimentId); adapter(snapshot, kit); kit.endFrame();
  assert.equal(JSON.stringify(snapshot), before, `${snapshot.experimentId}: renderer mutated the engine snapshot`);
  const objects = kit.group.children.filter(object => object.visible);
  assert.ok(objects.length > 0, `${snapshot.experimentId}: adapter did not express any apparatus`);
  assert.ok(objects.some(object => object.isMesh), `${snapshot.experimentId}: apparatus is not 3D`);
  const keys = objects.map(object => object.userData.retainedKey);
  assert.ok(keys.every(key => typeof key === 'string'), `${snapshot.experimentId}: a part bypasses retained identity`);
  assert.equal(new Set(keys).size, keys.length, `${snapshot.experimentId}: entity/subpart identity collision`);
  for (const object of objects) {
    for (const value of [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]) assert.ok(Number.isFinite(value), `${snapshot.experimentId}: non-finite transform`);
    if (object.geometry) {
      const { boundingBox } = object.geometry;
      if (boundingBox && !boundingBox.isEmpty()) for (const value of [...boundingBox.min.toArray(), ...boundingBox.max.toArray()]) assert.ok(Number.isFinite(value), `${snapshot.experimentId}: non-finite geometry bounds`);
    }
  }
  return new Map(objects.map(object => [object.userData.retainedKey, { object, geometry: object.geometry, material: object.material }]));
}
function sameParts(before, after, id, all = true) {
  if (all) assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${id}: unchanged frame changed part identities`);
  for (const [key, item] of after) if (before.has(key)) {
    assert.equal(item.object, before.get(key).object, `${id}: Object3D was reallocated`);
    assert.equal(item.geometry, before.get(key).geometry, `${id}: same-topology geometry was reallocated`);
    assert.equal(item.material, before.get(key).material, `${id}: material was reallocated`);
  }
}
function parameterCandidate(parameter) {
  if (!Number.isFinite(parameter.value)) return undefined;
  const delta = Number.isFinite(parameter.step) && parameter.step > 0 ? parameter.step : Math.abs(parameter.value) * 0.1 || 0.1;
  for (const value of [parameter.value + delta, parameter.value - delta]) if ((parameter.min === undefined || value >= parameter.min) && (parameter.max === undefined || value <= parameter.max) && value !== parameter.value) return value;
  return undefined;
}

test('the live Lab Collection retains exactly 76 experiments in all twelve domains', () => {
  assert.equal(registry.length, 76);
  assert.equal(new Set(registry.map(item => item.id)).size, 76);
  assert.equal(new Set(registry.map(item => item.domain)).size, 12);
  for (const item of registry) assert.ok(drawers[item.domain], `${item.id}: uncovered domain`);
});

for (const item of registry) test(`apparatus/engine regression ${item.id} (${item.domain})`, () => {
  const runtime = createExperiment(item.id), initial = snapshotOf(runtime, item.id), kit = createSceneKit(initial.view);
  try {
    const first = draw(kit, initial), stats = { ...kit.stats };
    for (let repeat = 0; repeat < 3; repeat += 1) sameParts(first, draw(kit, snapshotOf(runtime, item.id)), item.id);
    assert.equal(kit.stats.meshAllocations, stats.meshAllocations, `${item.id}: identical frame allocated mesh`);
    assert.equal(kit.stats.geometryAllocations, stats.geometryAllocations, `${item.id}: identical frame allocated geometry`);
    assert.equal(kit.stats.materialAllocations, stats.materialAllocations, `${item.id}: identical frame allocated material`);
    assert.equal(kit.stats.bufferGrowths, stats.bufferGrowths, `${item.id}: identical frame grew a buffer`);

    // Same native entities in a different order cannot recolor/reassign parts.
    const arrays = ['bodies', 'circuitComponents', 'circuitWires', 'circuitJunctions', 'pointChargeSources', 'opticalElements', 'opticalObjects', 'opticalScreens', 'waveSources', 'inductionPairBars', 'transformerCoils'];
    const reordered = { ...initial, view: { ...initial.view } };
    for (const name of arrays) if (Array.isArray(reordered.view[name])) reordered.view[name] = reordered.view[name].slice().reverse();
    sameParts(first, draw(kit, reordered), item.id);

    const visibility = Object.keys(initial.view.visible ?? {}).filter(key => initial.view.visible[key]);
    if (visibility.length) {
      for (const key of visibility) runtime.setObservable(key, false);
      draw(kit, snapshotOf(runtime, item.id));
      for (const key of visibility) runtime.setObservable(key, true);
      sameParts(first, draw(kit, snapshotOf(runtime, item.id)), item.id);
    }

    if (Number.isFinite(initial.clock?.total) && initial.clock.total > 0) {
      runtime.seek(initial.clock.total * 0.42); draw(kit, snapshotOf(runtime, item.id));
      runtime.seek(initial.clock.total); draw(kit, snapshotOf(runtime, item.id));
      runtime.seek(initial.clock.time ?? 0); draw(kit, snapshotOf(runtime, item.id));
      sameParts(first, draw(kit, initial), item.id);
    }

    const parameters = runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? []);
    const parameter = parameters.find(p => parameterCandidate(p) !== undefined);
    if (parameter) {
      const original = parameter.value, candidate = parameterCandidate(parameter);
      runtime.editParameter(parameter.id, candidate);
      const changed = snapshotOf(runtime, item.id);
      const actual = changed.inspector.flatMap(section => section.parameters ?? []).find(p => p.id === parameter.id)?.value;
      assert.ok(Number.isFinite(actual), `${item.id}: parameter round-trip disappeared`);
      assert.ok(Math.abs(actual - candidate) <= Math.max(1e-12, Math.abs(candidate) * 1e-8), `${item.id}: parameter did not round-trip`);
      draw(kit, changed);
      runtime.editParameter(parameter.id, original); draw(kit, snapshotOf(runtime, item.id));
    }
    if (item.id === 'photoelectric-effect') assert.equal(parameters.length, 6, 'runtime capability must expose all six photoelectric parameters');
  } finally { kit.dispose(); runtime.dispose?.(); }
});
