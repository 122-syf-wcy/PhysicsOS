// Execute only with the server-staged, pinned Three.js kit. Synthetic contract
// frames below are regression inputs, never new product physics or trajectories.
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { cartApparatus, precisionRail, suspensionClamp, lensApparatus, opticalScreen, winding, hotplate, apparatusColors } from './src/apparatus.js';
import { drawMechanics } from './src/mechanics.js';
import { drawCircuits } from './src/circuits.js';
import { drawFields } from './src/fields.js';
import { drawOptics } from './src/optics.js';
import { drawWaves } from './src/waves.js';
import { drawMatter } from './src/matter.js';

assert.ok(process.env.PHYSICSOS_LAB_KIT_MODULE, 'Use the server-staged Three.js 0.180.0 scene kit');
const { createSceneKit } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_KIT_MODULE));
const close = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const pointClose = (a, b, epsilon = 1e-5) => { close(a.x, b.x, epsilon); close(a.y, b.y, epsilon); close(a.z ?? 0, b.z ?? 0, epsilon); };
const viewOf = (domain, extra = {}) => ({ domain, origin: { x: -6, y: -4 }, extent: { width: 12, height: 8 }, grid: { minor: 0.2, major: 1 }, axes: { x: 'x', y: 'y' }, tickStep: 1, visible: {}, bodies: [], particles: [], vectors: [], trajectories: [], labels: [], dimensions: [], ...extra });
const frameOf = (domain, extra = {}, experimentId = domain) => ({ experimentId, domain, revision: 1, inspector: [], view: viewOf(domain, extra) });
const active = (kit, predicate = () => true) => kit.group.children.filter(object => object.visible && predicate(object));
const named = (kit, name) => active(kit, object => object.name === name)[0];
const bounds = (kit, object) => { kit.group.updateMatrixWorld(true); return new kit.THREE.Box3().setFromObject(object); };
function render(kit, snapshot, draw) {
  const before = JSON.stringify(snapshot);
  kit.beginFrame(snapshot.view, snapshot.experimentId);
  draw(snapshot, kit); kit.endFrame();
  assert.equal(JSON.stringify(snapshot), before, 'adapter must not modify the trusted frame');
}
function retained(kit) { return new Map(active(kit).map(object => [object.userData.retainedKey, object])); }
function assertRetained(before, kit) {
  for (const [key, object] of retained(kit)) if (before.has(key)) {
    assert.equal(object, before.get(key), `Object identity changed: ${key}`);
    if (object.geometry) assert.equal(object.geometry, before.get(key).geometry);
    if (object.material) assert.equal(object.material, before.get(key).material);
  }
}

test('cart local origin is COM, four tyre contacts fit the rail and identities survive reorder', () => {
  const body = { id: 'cart-a', at: { x: 2, y: 1, z: 0.2 }, size: 0.4, rotation: 30 }, kit = createSceneKit(viewOf('mechanics'));
  const cart = cartApparatus(body, kit);
  pointClose(cart.anchors.centerOfMass, body.at);
  pointClose(cart.anchors.contactRear, cart.frame.at(-body.size, -body.size));
  pointClose(cart.anchors.contactFront, cart.frame.at(body.size, -body.size));
  const wheels = active(kit, object => object.name.startsWith('cart-a-wheel-'));
  assert.equal(wheels.length, 4);
  assert.equal(new Set(wheels.map(object => object.userData.retainedKey)).size, 4);
  const rail = precisionRail({ from: -3, to: 5, y: 0, z: 0.2 }, kit, { gauge: body.size * 0.9, major: 1, key: 'rail-contract' });
  assert.equal(rail.anchors.wheelGauge, body.size * 0.9);
  for (const shoulder of active(kit, object => object.name.startsWith('mechanics-rail-'))) close(bounds(kit, shoulder).max.y, 0);
  kit.dispose();

  const a = { ...body, rotation: 0, at: { x: 0, y: 1, z: 0 } }, b = { ...body, id: 'cart-b', rotation: -35, at: { x: 3, y: 2, z: 0 } };
  const frame = frameOf('mechanics', { bodies: [a, b] }, 'cart-contract'), display = createSceneKit(frame.view);
  render(display, frame, drawMechanics); const identities = retained(display), stats = { ...display.stats };
  render(display, { ...frame, revision: 2, view: { ...frame.view, bodies: [b, a] } }, drawMechanics);
  assertRetained(identities, display);
  assert.equal(display.stats.meshAllocations, stats.meshAllocations);
  assert.equal(display.stats.geometryAllocations, stats.geometryAllocations);
  assert.equal(display.stats.materialAllocations, stats.materialAllocations);
  display.dispose();
});

test('suspension tip, rotated winding axes and heater contact plane are explicit', () => {
  const kit = createSceneKit(viewOf('mechanics')), at = { x: 3, y: 4, z: 2 };
  const clamp = suspensionClamp({ id: 'support', at, size: 0.5 }, kit);
  pointClose(clamp.anchors.suspension, at);
  const coil = winding(kit, at, 2, 0.6, 8, { key: 'tilted-coil', rotation: 90, flange: true });
  close(coil.anchors.wireStart.x, at.x); close(coil.anchors.wireStart.y, at.y - 2);
  close(coil.anchors.wireEnd.x, at.x); close(coil.anchors.wireEnd.y, at.y + 2);
  for (const flange of active(kit, object => object.userData.retainedKey?.includes('flange:'))) {
    const normal = new kit.THREE.Vector3(0, 1, 0).applyQuaternion(flange.quaternion);
    close(normal.x, 0); close(normal.y, 1); close(normal.z, 0);
  }
  const heater = hotplate({ id: 'hotplate', at, halfWidth: 1.4, power: '0 W' }, kit);
  pointClose(heater.anchors.contactPlane, at);
  close(bounds(kit, named(kit, 'hotplate-plate')).max.y, at.y);
  assert.ok(kit.labels.some(label => label.text === '0 W'));
  kit.dispose();
});

test('force table hardware is independent of display-scaled vectors', () => {
  const body = { id: 'force-body', kind: 'block', at: { x: 0, y: 0 }, size: 0.3 }, frame = frameOf('mechanics', { bodies: [body], vectors: [{ id: 'F1', role: 'force', from: body.at, to: { x: 1, y: 2 } }] }, 'force-composition');
  const kit = createSceneKit(frame.view); render(kit, frame, drawMechanics);
  const first = retained(kit), before = active(kit).map(object => ({ key: object.userData.retainedKey, position: object.position.toArray(), scale: object.scale.toArray() }));
  render(kit, { ...frame, view: { ...frame.view, vectors: [{ ...frame.view.vectors[0], to: { x: 1000, y: -2000 } }] } }, drawMechanics);
  assertRetained(first, kit);
  assert.deepEqual(active(kit).map(object => ({ key: object.userData.retainedKey, position: object.position.toArray(), scale: object.scale.toArray() })), before);
  assert.ok(!active(kit).some(object => /cord|fixture/.test(object.name)), 'display force endpoints cannot become cord attachments');
  kit.dispose();
});

test('energy ledger has exact zero/tiny shares and ink direct labels, not normalized fills', () => {
  const frame = frameOf('mechanics', { energyBar: { id: 'energy', at: { x: 0, y: -1, z: 0.2 }, width: 4, height: 0.2, totalText: 'E = 1 J', segments: [{ id: 'potential', role: 'potential', fraction: 0, text: 'Ep = 0 J' }, { id: 'kinetic', role: 'kinetic', fraction: 1e-10, text: 'Ek = 1e-10 J' }, { id: 'thermal', role: 'thermal', fraction: 0.25, text: 'Q = 0.25 J' }] } }, 'mechanical-energy');
  const kit = createSceneKit(frame.view); render(kit, frame, drawMechanics);
  assert.equal(named(kit, 'energy-segment-potential'), undefined);
  const tiny = bounds(kit, named(kit, 'energy-segment-kinetic'));
  close(tiny.max.x - tiny.min.x, 4e-10, 1e-15);
  const heat = bounds(kit, named(kit, 'energy-segment-thermal'));
  close(heat.max.x - heat.min.x, 1);
  assert.ok(kit.labels.some(label => label.text === 'Ep = 0 J'));
  for (const label of kit.labels.filter(label => label.tag?.startsWith('energy-label-'))) assert.equal(label.color, apparatusColors.ink);
  kit.dispose();
});

test('circuit terminals match rotated a/b anchors including tiny radians', () => {
  for (const [rotation, rotationUnit] of [[0, 'deg'], [90, 'deg'], [180, 'deg'], [Math.PI / 2, 'rad'], [0.01, 'rad']]) {
    const component = { id: 'r', kind: 'resistor', at: { x: 2, y: -1, z: 0.4 }, rotation, rotationUnit, label: 'R', value: '0 Ω', currentText: '0 A' }, frame = frameOf('circuit', { circuitComponents: [component] });
    const kit = createSceneKit(frame.view); render(kit, frame, drawCircuits);
    const angle = rotationUnit === 'rad' ? rotation : rotation * Math.PI / 180;
    const contacts = active(kit, object => object.userData.apparatus?.factory === 'binding-terminal').map(object => object.userData.apparatus.anchors.electricalContact);
    assert.equal(contacts.length, 2);
    for (const side of [-1, 1]) assert.ok(contacts.some(p => Math.abs(p.x - (2 + side * 0.75 * Math.cos(angle))) < 1e-10 && Math.abs(p.y - (-1 + side * 0.75 * Math.sin(angle))) < 1e-10 && p.z === 0.4));
    assert.ok(kit.labels.some(label => label.text.includes('0 Ω')));
    kit.dispose();
  }
});

test('lamp emissive state and switch lever are retained and isolated per entity', () => {
  const frame = frameOf('circuit', { circuitComponents: [{ id: 'r0', kind: 'resistor', at: { x: 0, y: 0 }, rotation: 0, label: 'lamp', glow: 1 }, { id: 'r1', kind: 'resistor', at: { x: 3, y: 0 }, rotation: 0, label: 'resistor' }, { id: 's0', kind: 'switch', at: { x: -3, y: 0 }, rotation: 0, closed: true, label: 'S' }] }, 'bulb-power');
  const kit = createSceneKit(frame.view); render(kit, frame, drawCircuits);
  const bulb = named(kit, 'r0:bulb'), lever = named(kit, 's0:closed-lever'), other = active(kit, object => object.material && object !== bulb).map(object => ({ object, emissive: object.material.emissive?.getHex(), material: object.material }));
  assert.ok(bulb.material.emissiveIntensity > 0);
  const next = { ...frame, view: { ...frame.view, circuitComponents: frame.view.circuitComponents.map(item => item.id === 'r0' ? { ...item, glow: 0 } : item.id === 's0' ? { ...item, closed: false } : item) } };
  render(kit, next, drawCircuits);
  assert.equal(named(kit, 'r0:bulb'), bulb);
  assert.equal(bulb.material.emissiveIntensity, 0);
  assert.equal(named(kit, 's0:open-lever'), lever);
  for (const item of other) assert.equal(item.object.material, item.material);
  assert.ok(!other.some(item => item.object.material === bulb.material));
  kit.dispose();
});

test('exact circuit wire bends and zero/tiny signed current markers follow native path', () => {
  const points = [{ x: 0, y: 0, z: 0.2 }, { x: 2, y: 0, z: 0.2 }, { x: 2, y: 1, z: 0.2 }], frame = frameOf('circuit', { circuitWires: [{ id: 'wire', points }], chargeFlows: [{ id: 'flow', path: points, current: 0 }] });
  const kit = createSceneKit(frame.view); render(kit, frame, drawCircuits);
  const conductor = named(kit, 'wire'); assert.ok(conductor);
  assert.equal(named(kit, 'flow:direction'), undefined);
  render(kit, { ...frame, view: { ...frame.view, chargeFlows: [{ id: 'flow', path: points, current: -1e-20 }] } }, drawCircuits);
  assert.equal(named(kit, 'wire'), conductor);
  const arrow = named(kit, 'flow:direction'), direction = new kit.THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
  assert.ok(direction.x < 0 || direction.y < 0);
  kit.dispose();
});

test('lens aperture and YZ screen are centered in native z without fake thick-lens parameters', () => {
  const kit = createSceneKit(viewOf('optics')), element = { id: 'lens', kind: 'thin_lens', at: { x: 2, y: 1, z: 0.7 }, halfAperture: 1.5 };
  const lens = lensApparatus(element, -2, kit); pointClose(lens.anchors.opticalCenter, element.at);
  const pane = named(kit, 'lens'); close(pane.position.x, 2); close(pane.position.y, 1); close(pane.position.z, 0.7);
  assert.equal(pane.material.transmission ?? 0, 0);
  assert.equal(pane.material.depthWrite, false);
  const screen = opticalScreen({ id: 'screen', at: { x: 5, y: 1, z: 0.7 }, halfHeight: 1, lit: true }, -2, kit), box = bounds(kit, screen.face);
  close((box.min.x + box.max.x) / 2, 5); close((box.min.z + box.max.z) / 2, 0.7);
  assert.ok(box.max.z - box.min.z > box.max.x - box.min.x);
  kit.dispose();
});

test('signed real/virtual image semantics and total-reflection visibility are retained', () => {
  const frame = frameOf('optics', { opticalImages: [{ id: 'image', at: { x: 3, y: 1, z: 0.5 }, height: -1.4, nature: 'virtual', label: '像' }] }, 'convex-lens'), kit = createSceneKit(frame.view);
  render(kit, frame, drawOptics);
  const image = named(kit, 'image'); assert.ok(image?.isLine); assert.equal(image.material.type, 'LineDashedMaterial');
  assert.ok(kit.labels.some(label => label.text.includes('虚像')));
  const points = image.geometry.attributes.position.array; close(points[1], 1); close(points[4], -0.4); close(points[2], 0.5); close(points[5], 0.5);
  render(kit, { ...frame, view: { ...frame.view, visible: { image: false } } }, drawOptics); assert.equal(named(kit, 'image'), undefined);
  render(kit, { ...frame, view: { ...frame.view, opticalImages: [{ ...frame.view.opticalImages[0], nature: 'real' }] } }, drawOptics); assert.equal(named(kit, 'image').type, 'ArrowHelper');
  const r = { id: 'refraction', at: { x: 0, y: 0, z: 0.3 }, boundaryFrom: { x: -2, y: 0, z: 0.3 }, boundaryTo: { x: 2, y: 0, z: 0.3 }, normalFrom: { x: 0, y: -2, z: 0.3 }, normalTo: { x: 0, y: 2, z: 0.3 }, incidentFrom: { x: -1, y: -1, z: 0.3 }, reflectedTo: { x: 1, y: -1, z: 0.3 }, refractedTo: { x: 1, y: 1, z: 0.3 }, total: true };
  const total = frameOf('optics', { lightRefraction: r }, 'total-reflection'); render(kit, total, drawOptics);
  assert.equal(named(kit, 'refraction-refracted'), undefined);
  render(kit, { ...total, view: { ...total.view, lightRefraction: { ...r, total: false } } }, drawOptics);
  assert.ok(named(kit, 'refraction-refracted'));
  kit.dispose();
});

test('diffraction uses semantic slit width and absolute sampled y, never formatted rows or plot x', () => {
  const rig = { id: 'slit', slitAt: { x: 0, y: 3, z: 0.4 }, screenAt: { x: 8, y: 3, z: 0.4 }, slitWidth: 0.2, screenHalfHeight: 2, intensitySamples: [{ id: 's0', y: 2, intensity: 0 }, { id: 's1', y: 3, intensity: 1e-18 }, { id: 's2', y: 4, intensity: 0.8 }] };
  const frame = frameOf('wave', { waveDiffraction: rig, trajectories: [{ id: 'wave-diffraction-intensity', points: [{ x: 999, y: 2 }, { x: -999, y: 4 }] }] }, 'wave-diffraction');
  frame.inspector = [{ derived: [{ id: 'slit_width', value: '100000000000', unit: 'm' }] }];
  const kit = createSceneKit(frame.view); render(kit, frame, drawWaves);
  const lower = named(kit, 'diffraction-slit-lower'), upper = named(kit, 'diffraction-slit-upper');
  close(bounds(kit, upper).min.y - bounds(kit, lower).max.y, 0.2);
  const bands = active(kit, object => object.name.startsWith('diffraction-band-'));
  assert.equal(bands.length, 2);
  close(bands[0].position.y, 2.5); close(bands[1].position.y, 3.5);
  assert.ok(bands[0].material.color.r > 0, 'tiny nonzero intensity is not clamped to zero');
  const first = retained(kit);
  render(kit, { ...frame, inspector: [{ derived: [{ id: 'slit_width', value: '0', unit: 'm' }] }], view: { ...frame.view, trajectories: [{ id: 'wave-diffraction-intensity', points: [{ x: 0, y: -1 }, { x: 1, y: 1 }] }] } }, drawWaves);
  assertRetained(first, kit);
  render(kit, { ...frame, view: { ...frame.view, waveDiffraction: { ...rig, slitWidth: 0 }, visible: { waveform: false } } }, drawWaves);
  close(bounds(kit, named(kit, 'diffraction-slit-upper')).min.y, 3); close(bounds(kit, named(kit, 'diffraction-slit-lower')).max.y, 3);
  assert.equal(active(kit, object => object.name.startsWith('diffraction-band-')).length, 0);
  const legacy = { ...frame, view: { ...frame.view, waveDiffraction: undefined, labels: [{ id: 'wave-screen-label', at: rig.screenAt }] } };
  render(kit, legacy, drawWaves);
  assert.equal(active(kit, object => object.name.startsWith('diffraction-slit-')).length, 0);
  assert.equal(active(kit, object => object.name.startsWith('diffraction-band-')).length, 0);
  kit.dispose();
});

test('motor snapshot angle is static, zero torque hides sense and poles ignore scaled arrows', () => {
  const rotor = { id: 'motor', at: { x: 0, y: 0, z: 0.2 }, sides: [{ x: 0, y: -2, z: 0.2 }, { x: 0, y: 2, z: 0.2 }], halfWidth: 2, angle: Math.PI / 2, sense: 1, torque: 0, sideForce: 0.01, statorDirection: { x: 1, y: 0 }, torqueText: 'τ=0', forces: [] };
  const frame = frameOf('magnetic', { currentRotor: rotor, vectors: [{ id: 'stator-field', from: { x: 1, y: 1 }, to: { x: -100, y: 1 } }] }, 'motor');
  const kit = createSceneKit(frame.view); render(kit, frame, drawFields);
  assert.equal(named(kit, 'motor:rotation-sense'), undefined);
  const poleLabels = kit.labels.filter(label => label.text === 'N' || label.text === 'S');
  assert.equal(poleLabels.find(label => label.text === 'N').at.x < 0, true);
  const sides = active(kit, object => object.name.startsWith('motor:side:')).map(object => ({ object, at: object.position.toArray() }));
  const first = retained(kit);
  render(kit, { ...frame, revision: 2, clock: { time: 100, total: 100, running: true } }, drawFields);
  assertRetained(first, kit);
  for (const side of sides) assert.deepEqual(side.object.position.toArray(), side.at);
  render(kit, { ...frame, view: { ...frame.view, currentRotor: { ...rotor, torque: -1e-14 } } }, drawFields);
  assert.ok(named(kit, 'motor:rotation-sense'));
  kit.dispose();
});

test('fluid displacement and thermal fractions preserve dry/zero/tiny states without invented bubbles', () => {
  const block = { id: 'block', at: { x: 0, y: 1, z: 0.3 }, halfWidth: 0.4, halfHeight: 0.5, submergedTop: 0.5, phase: 'dry' }, frame = frameOf('fluid', { fluidLiquid: { id: 'tank', left: -2, right: 2, floor: -1, surface: 0 }, fluidBlock: block }, 'buoyancy'), kit = createSceneKit(frame.view);
  render(kit, frame, drawMatter); assert.equal(named(kit, 'block-displaced'), undefined);
  render(kit, { ...frame, view: { ...frame.view, fluidBlock: { ...block, submergedTop: 0.75, phase: 'entering' } } }, drawMatter);
  const displaced = bounds(kit, named(kit, 'block-displaced')); close(displaced.max.y, 0.75); close(displaced.min.y, 0.5);
  const sample = { id: 'sample', at: { x: -1, y: 1, z: 0.2 }, halfWidth: 0.6, halfHeight: 1, meltedFraction: 1e-12, phase: 'melting' }, thermal = frameOf('thermal', { thermalSample: sample }, 'crystal-melting');
  render(kit, thermal, drawMatter);
  const liquid = bounds(kit, named(kit, 'sample-liquid-fraction')); close(liquid.max.y - liquid.min.y, 2e-12, 1e-15);
  render(kit, { ...thermal, view: { ...thermal.view, thermalSample: { ...sample, meltedFraction: 0 } } }, drawMatter); assert.equal(named(kit, 'sample-liquid-fraction'), undefined);
  render(kit, { ...thermal, view: { ...thermal.view, thermalSample: { ...sample, meltedFraction: 1, phase: 'boiling' } } }, drawMatter); assert.equal(named(kit, 'sample-solid-fraction'), undefined);
  assert.ok(!active(kit).some(object => /bubble/.test(object.name)), 'no fabricated boiling particle positions');
  render(kit, { ...thermal, view: { ...thermal.view, visible: { phase: false } } }, drawMatter); assert.equal(named(kit, 'sample-liquid-fraction'), undefined); assert.ok(named(kit, 'sample-sample'));
  kit.dispose();
});

test('solid-pressure footprint preserves square area ratios and comparison visibility', () => {
  const solid = { id: 'solid', at: { x: -1, y: 1 }, halfHeight: 1, plateDepth: 0.1, faces: [{ id: 'large', at: { x: -1, y: 0 }, halfWidth: 0.7, loaded: true, pressureText: 'p' }, { id: 'small', at: { x: 2, y: 0 }, halfWidth: 0.35, loaded: false, pressureText: '4p' }] }, frame = frameOf('fluid', { pressureRig: 'solid', pressureSolid: solid }, 'solid-pressure');
  const kit = createSceneKit(frame.view); render(kit, frame, drawMatter);
  const large = bounds(kit, named(kit, 'large-plate')), small = bounds(kit, named(kit, 'small-plate'));
  close((large.max.x - large.min.x) / (small.max.x - small.min.x), 2);
  close((large.max.z - large.min.z) / (small.max.z - small.min.z), 2);
  render(kit, { ...frame, view: { ...frame.view, visible: { pressureComparison: false } } }, drawMatter); assert.equal(named(kit, 'small-plate'), undefined);
  kit.dispose();
});

test('photoelectric fixed semantic electrodes do not move with emission and zero readings remain visible', () => {
  const rig = { id: 'photo', cathodeAt: { x: 0, y: 0, z: 0.2 }, collectorAt: { x: 160, y: 0, z: 0.2 }, sourceAt: { x: -170, y: 0, z: 0.2 }, halfHeight: 60, photocurrentText: '0 A', stoppingPotentialText: '0 V' };
  const frame = frameOf('modern', { extent: { width: 400, height: 220 }, origin: { x: -200, y: -110 }, photoelectricRig: rig, particles: [{ id: 'modern-cathode', at: rig.cathodeAt, radius: 16 }], trajectories: [] }, 'photoelectric-effect');
  const kit = createSceneKit(frame.view); render(kit, frame, drawMatter);
  const collector = named(kit, 'photoelectric-collector'), position = collector.position.toArray(), first = retained(kit);
  assert.ok(kit.labels.some(label => label.text === '0 A')); assert.ok(kit.labels.some(label => label.text === '0 V'));
  render(kit, { ...frame, view: { ...frame.view, particles: [...frame.view.particles, { id: 'modern-photoelectron', at: { x: 85, y: 0 }, radius: 7 }], trajectories: [{ id: 'modern-electron-0', points: [{ x: 0, y: 0 }, { x: 999, y: 30 }] }] } }, drawMatter);
  assertRetained(first, kit); assert.equal(named(kit, 'photoelectric-collector'), collector); assert.deepEqual(collector.position.toArray(), position);
  kit.dispose();
});

test('calibrated thermometer fixed points and column retain their absolute scene coordinates', () => {
  const t = { id: 'thermo', at: { x: 2, y: 1, z: 0.5 }, halfWidth: 0.04, bulbRadius: 0.1, columnTop: 4.2, icePoint: 2, steamPoint: 7, temperatureText: '44 °C', columnText: '4.2 cm' }, frame = frameOf('thermal', { thermometer: t }, 'thermometer');
  const kit = createSceneKit(frame.view); render(kit, frame, drawMatter);
  close(bounds(kit, named(kit, 'thermo-column')).max.y, 4.2);
  pointClose(kit.labels.find(label => label.text === '0 °C').at, { x: 2 + 0.04 * 4.2, y: 2, z: 0.5 });
  pointClose(kit.labels.find(label => label.text === '100 °C').at, { x: 2 + 0.04 * 4.2, y: 7, z: 0.5 });
  render(kit, { ...frame, view: { ...frame.view, visible: { thermometer: false, guides: false } } }, drawMatter); assert.equal(named(kit, 'thermo-column'), undefined); assert.ok(named(kit, 'thermo-tube'));
  kit.dispose();
});
