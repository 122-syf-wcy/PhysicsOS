/* Electric, magnetic, composite and induction apparatus. Geometry consumes
 * SceneVisualModel facts only: no field evaluation, orbit integration, circuit
 * solving or independent clock. Root owns particles and common vector layers. */
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const positive = n => Number.isFinite(n) && n > 0;
const offset = (p, x = 0, y = 0, z = 0) => ({ x: p.x + x, y: p.y + y, z: (p.z || 0) + z });
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t });

// Field annotations remain readable through a coil/core, without moving their
// world coordinates forward or changing their physical endpoints.
function annotation(object) {
  if (!object) return object;
  object.traverse?.(child => {
    child.renderOrder = 4;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) if (material) { material.depthTest = false; material.depthWrite = false; }
  });
  return object;
}

function exactWire(kit, points, radius, color, tag) {
  for (let i = 1; i < points.length; i += 1) {
    if (validPoint(points[i - 1]) && validPoint(points[i])) kit.cylinder(points[i - 1], points[i], radius, color, { tag });
  }
}

function rectOf(at, width, height) {
  if (!validPoint(at) || !positive(width) || !positive(height)) return undefined;
  return { at, width, height, left: at.x - width / 2, right: at.x + width / 2, bottom: at.y - height / 2, top: at.y + height / 2 };
}

function sceneRect(view) {
  if (!validPoint(view.origin) || !view.extent) return undefined;
  return rectOf(offset(view.origin, view.extent.width / 2, view.extent.height / 2), view.extent.width, view.extent.height);
}

function regionPlate(kit, rect, color, tag, label) {
  if (!rect) return;
  const { at, width, height, left, right, bottom, top } = rect;
  const detail = Math.min(kit.unit, width / 3, height / 3);
  kit.box(offset(at, 0, 0, -detail * 0.17), width, height, detail * 0.1, color, { opacity: 0.075, tag });
  kit.line([
    { x: left, y: bottom }, { x: right, y: bottom },
    { x: right, y: top }, { x: left, y: top }, { x: left, y: bottom },
  ], color, { opacity: 0.58, tag: `${tag}:boundary` });
  // Thin metal corner clips give a transparent field chamber a physical edge.
  for (const x of [left, right]) for (const y of [bottom, top]) {
    kit.box({ x, y, z: -detail * 0.14 }, detail * 0.08, detail * 0.08, detail * 0.18, kit.palette.metal, { tag: `${tag}:corner` });
  }
  if (label) kit.label(label, { x: at.x, y: top + detail * 0.34, z: 0 }, { color: kit.palette.ink, size: 11, priority: 3, tag: `${tag}:label` });
}

function lattice(rect, spacing, visit) {
  if (!rect || !positive(spacing)) return;
  const columns = Math.max(1, Math.floor(rect.width / spacing));
  const rows = Math.max(1, Math.floor(rect.height / spacing));
  // Snapshots use a modest glyph grid. Guard pathological data without changing
  // the spacing or allowing an unbounded per-frame allocation.
  const stride = Math.max(1, Math.ceil(Math.sqrt(columns * rows / 700)));
  const startX = rect.at.x - (columns - 1) * spacing / 2;
  const startY = rect.at.y - (rows - 1) * spacing / 2;
  for (let x = 0; x < columns; x += stride) for (let y = 0; y < rows; y += stride) {
    visit({ x: startX + x * spacing, y: startY + y * spacing, z: rect.at.z || 0 }, Math.min(spacing, rect.width, rect.height), `${x}-${y}`);
  }
}

function electricGrid(kit, rect, field, tag) {
  if (!field || !validPoint(field.direction) || !kit.visible('electricField')) return;
  const { x: dx, y: dy } = field.direction;
  if (dx === 0 && dy === 0) return;
  lattice(rect, field.spacing, (at, spacing, id) => {
    let half = spacing * 0.31;
    if (dx !== 0) half = Math.min(half, (at.x - rect.left) / Math.abs(dx), (rect.right - at.x) / Math.abs(dx));
    if (dy !== 0) half = Math.min(half, (at.y - rect.bottom) / Math.abs(dy), (rect.top - at.y) / Math.abs(dy));
    if (half > 0) annotation(kit.arrow(offset(at, -dx * half, -dy * half), offset(at, dx * half, dy * half), '#7caaa5', { tag: `${tag}:E:${id}` }));
  });
}

function fieldMark(kit, at, radius, direction, tag, color = '#93a6bc', ring = false) {
  if (!positive(radius)) return;
  if (ring) annotation(kit.circle(at, radius, color, { tag: `${tag}:ring` }));
  if (direction === 'into-page' || direction === 'into' || direction === -1) {
    const half = radius * (ring ? 0.53 : 0.8);
    annotation(kit.line([offset(at, -half, -half), offset(at, half, half)], color, { tag: `${tag}:into` }));
    annotation(kit.line([offset(at, -half, half), offset(at, half, -half)], color, { tag: `${tag}:into` }));
  } else if (direction === 'out-of-page' || direction === 'out' || direction === 1) {
    annotation(kit.sphere(at, radius * 0.27, color, { tag: `${tag}:out` }));
  }
}

function magneticGrid(kit, rect, field, tag) {
  if (!field || !kit.visible('magneticField')) return;
  lattice(rect, field.spacing, (at, spacing, id) => fieldMark(kit, at, spacing * 0.09, field.direction, `${tag}:B:${id}`));
}

function pathArrow(kit, points, fraction, color, tag) {
  if (!points || points.length < 2 || !Number.isFinite(fraction)) return;
  let total = 0;
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (!validPoint(a) || !validPoint(b)) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
    if (length > 0) { segments.push({ a, b, length }); total += length; }
  }
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (const { a, b, length } of segments) {
    if (remaining <= length) {
      const t = remaining / length;
      const arrowSpan = Math.min(kit.unit * 0.2 / length, 0.42);
      const start = Math.max(0, Math.min(1 - arrowSpan, t - arrowSpan / 2));
      annotation(kit.arrow(mix(a, b, start), mix(a, b, start + arrowSpan), color, { tag }));
      return;
    }
    remaining -= length;
  }
}

function streamlineArrow(kit, streamline) {
  const points = streamline.points || [];
  const tip = streamline.arrowAt;
  if (!validPoint(tip) || points.length < 2) return;
  let closest = -1, distance = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    if (!validPoint(points[i - 1]) || !validPoint(points[i])) continue;
    const d = Math.hypot(points[i].x - tip.x, points[i].y - tip.y);
    if (d < distance) { distance = d; closest = i; }
  }
  if (closest < 1) return;
  const before = points[closest - 1];
  const length = Math.hypot(tip.x - before.x, tip.y - before.y);
  if (!length) return;
  const t = Math.min(1, kit.unit * 0.2 / length);
  annotation(kit.arrow(mix(tip, before, t), tip, kit.palette.green, { tag: `${streamline.id}:arrow` }));
}

function drawElectric(view, kit) {
  const { palette: p, unit: u } = kit;
  if (kit.visible('electricField')) for (const streamline of view.fieldStreamlines || []) {
    annotation(kit.line(streamline.points || [], '#8baea3', { opacity: 0.7, tag: streamline.id }));
    streamlineArrow(kit, streamline);
  }
  if (kit.visible('equipotentials')) for (const contour of view.equipotentials || []) {
    // The runtime already samples contours; retain their vertices and closure.
    const points = contour.points || [];
    const path = contour.closed && points.length > 2 ? [...points, points[0]] : points;
    annotation(kit.line(path, p.purple, { opacity: 0.57, dashed: true, tag: contour.id }));
  }
  for (const source of view.pointChargeSources || []) {
    if (!validPoint(source.at) || !positive(source.radius)) continue;
    const color = source.sign === 'negative' ? p.blue : p.red;
    kit.sphere(source.at, source.radius, color, { tag: source.id });
    kit.label(source.sign === 'negative' ? '−' : '+', offset(source.at, 0, -source.radius - u * 0.15), { color, size: 13, priority: 5, tag: `${source.id}:polarity` });
  }
  if (validPoint(view.probe?.at)) {
    kit.sphere(view.probe.at, u * 0.065, p.ink, { tag: view.probe.id });
    kit.circle(view.probe.at, u * 0.13, p.green, { tag: `${view.probe.id}:ring` });
  }
  for (const plate of view.plates || []) {
    if (!validPoint(plate.at) || !positive(plate.length)) continue;
    const thickness = Math.min(u * 0.12, plate.length * 0.035);
    kit.box(plate.at, plate.length, thickness, u * 0.42, p.metal, { tag: plate.id });
    kit.box(offset(plate.at, 0, 0, u * 0.218), plate.length, thickness * 0.37, u * 0.012, plate.sign === 'negative' ? p.blue : plate.sign === 'positive' ? p.red : p.green, { tag: `${plate.id}:face` });
    for (const x of [-0.43, 0.43]) kit.box(offset(plate.at, plate.length * x, 0, -u * 0.3), thickness * 0.8, thickness * 0.8, u * 0.2, '#dedbd0', { tag: `${plate.id}:standoff` });
    if (plate.sign) kit.label(plate.sign === 'positive' ? '+' : '−', offset(plate.at, 0, (plate.top ? 1 : -1) * u * 0.25, u * 0.25), { color: plate.sign === 'positive' ? p.red : p.blue, size: 12, priority: 4, tag: `${plate.id}:polarity` });
  }
  const bounded = view.boundedField;
  if (bounded && kit.visible('electricField')) {
    const rect = rectOf(bounded.at, bounded.width, bounded.height);
    regionPlate(kit, rect, p.green, 'bounded-electric-field');
    electricGrid(kit, rect, bounded, 'bounded-electric-field');
  } else if (view.electricField) electricGrid(kit, sceneRect(view), view.electricField, 'uniform-electric-field');
}

function drawCyclotronDee(kit, region) {
  const rect = rectOf(region.at, region.width, region.height);
  if (!rect) return;
  const left = region.id.endsWith('left');
  const inner = left ? rect.right : rect.left;
  const sign = left ? -1 : 1;
  const depth = Math.min(kit.unit * 0.35, region.width * 0.17);
  const points = Array.from({ length: 49 }, (_, i) => {
    const a = Math.PI * i / 48;
    return { x: inner + sign * region.width * Math.sin(a), y: region.at.y + region.height * 0.5 * Math.cos(a), z: -depth * 0.6 };
  });
  kit.polygon(points, depth, '#a8bcb5', { opacity: 0.7, tag: region.id });
  kit.line([...points, points[0]], kit.palette.green, { tag: `${region.id}:rim` });
  kit.label(left ? '左 D 形盒' : '右 D 形盒', { x: region.at.x, y: rect.top + kit.unit * 0.32, z: 0 }, { size: 11, priority: 3, tag: `${region.id}:label` });
}

function drawComposite(view, kit) {
  const { palette: p } = kit;
  for (const region of view.compositeRegions || []) {
    const rect = rectOf(region.at, region.width, region.height);
    if (!rect) continue;
    if (kit.visible('regions')) {
      if (region.id === 'cyclotron-dee-left' || region.id === 'cyclotron-dee-right') drawCyclotronDee(kit, region);
      else regionPlate(kit, rect, region.electricField && region.magneticField ? p.purple : region.magneticField ? p.blue : region.electricField ? p.green : p.metal, region.id, region.label);
    }
    electricGrid(kit, rect, region.electricField, region.id);
    magneticGrid(kit, rect, region.magneticField, region.id);
  }
}

function drawStraightWire(view, kit) {
  const wire = view.currentWire;
  if (!validPoint(wire?.at)) return;
  const { palette: p, unit: u } = kit;
  kit.cylinder(offset(wire.at, 0, 0, -u * 0.75), offset(wire.at, 0, 0, u * 0.25), u * 0.17, '#b58959', { tag: wire.id });
  kit.cylinder(offset(wire.at, 0, 0, u * 0.25), offset(wire.at, 0, 0, u * 0.27), u * 0.15, '#ede4ce', { tag: `${wire.id}:end-face` });
  fieldMark(kit, offset(wire.at, 0, 0, u * 0.28), u * 0.14, wire.direction, `${wire.id}:current`, p.ink, true);
  for (const circle of view.currentFieldCircles || []) {
    if (!kit.visible(circle.id.includes('comparison') ? 'fieldComparison' : 'fieldLines')) continue;
    if (!validPoint(circle.center) || !positive(circle.radius)) continue;
    const color = circle.probe ? p.blue : '#9fbab1';
    annotation(kit.circle(circle.center, circle.radius, color, { tag: circle.id }));
    for (const a of [Math.PI * 0.15, Math.PI * 0.8, Math.PI * 1.45]) {
      const delta = Math.min(0.08, u * 0.11 / circle.radius) * circle.circulation;
      annotation(kit.arrow(offset(circle.center, circle.radius * Math.cos(a - delta), circle.radius * Math.sin(a - delta)), offset(circle.center, circle.radius * Math.cos(a + delta), circle.radius * Math.sin(a + delta)), color, { tag: `${circle.id}:circulation` }));
    }
  }
  for (const probe of view.currentProbes || []) {
    if (!validPoint(probe.at) || !kit.visible(probe.primary ? 'fieldLines' : 'fieldComparison')) continue;
    kit.sphere(probe.at, u * 0.085, probe.primary ? p.green : p.blue, { tag: probe.id });
    kit.circle(probe.at, u * 0.16, p.ink, { tag: `${probe.id}:sensor` });
    kit.label(probe.readingText, offset(probe.at, 0, u * 0.37, u * 0.1), { size: 12, color: p.blue, priority: 4, tag: `${probe.id}:reading` });
  }
  kit.label(wire.currentText, offset(wire.at, 0, -u * 0.55), { size: 12, color: p.ink, priority: 3, tag: `${wire.id}:reading` });
}

function helix(kit, at, halfLength, radius, loops, color, tag, depthRatio = 1) {
  if (!validPoint(at) || !positive(halfLength) || !positive(radius) || !positive(loops)) return;
  const count = Math.max(1, Math.min(40, Math.round(loops)));
  const points = Array.from({ length: count * 28 + 1 }, (_, i) => {
    const t = i / (count * 28), a = t * Math.PI * 2 * count;
    return offset(at, -halfLength + halfLength * 2 * t, radius * Math.sin(a), radius * Math.cos(a) * depthRatio);
  });
  kit.tube(points, Math.min(kit.unit * 0.047, radius * 0.07, halfLength / count * 0.3), color, { tag });
}

function drawCoilRig(view, kit) {
  const coil = view.currentCoil;
  if (!validPoint(coil?.at)) return;
  const { palette: p, unit: u } = kit;
  const core = view.currentCore;
  if (validPoint(core?.at)) {
    kit.box(core.at, core.halfLength * 2, core.halfHeight * 2, core.halfHeight * 1.4, p.metal, { tag: core.id });
    for (const y of [-0.55, 0.55]) kit.line([offset(core.at, -core.halfLength, core.halfHeight * y, core.halfHeight * 0.705), offset(core.at, core.halfLength, core.halfHeight * y, core.halfHeight * 0.705)], '#8e9c98', { tag: `${core.id}:lamination` });
    const armature = offset(core.at, core.northPole * (core.halfLength + core.armatureHalfWidth));
    kit.box(armature, core.armatureHalfWidth * 2, core.armatureHalfHeight * 2, core.halfHeight * 1.8, p.ink, { tag: `${core.id}:armature` });
    kit.label(core.coreText, offset(core.at, 0, -coil.radius - u * 0.85), { size: 11, priority: 2, tag: `${core.id}:permeability` });
    if (kit.visible('fieldLines')) {
      kit.label(core.pullText, offset(armature, core.northPole * u * 0.9, u * 0.72), { size: 11, priority: 3, tag: `${core.id}:pull` });
      kit.label(core.heldMassText, offset(armature, core.northPole * u * 0.9, -u * 0.55), { size: 11, priority: 3, tag: `${core.id}:held-mass` });
      kit.label(core.airFieldText, offset(core.at, 0, coil.radius + u * 0.9), { size: 10, color: p.muted, priority: 1, tag: `${core.id}:air-field` });
    }
    if (kit.visible('fieldComparison')) kit.label([core.comparisonCoreText, core.comparisonPullText].filter(Boolean).join(' · '), offset(core.at, 0, -coil.radius - u * 1.23), { size: 10, color: p.muted, tag: `${core.id}:comparison` });
  } else {
    // A transparent insulating former makes the hollow air core readable.
    kit.cylinder(offset(coil.at, -coil.halfLength), offset(coil.at, coil.halfLength), coil.radius * 0.86, p.glass, { opacity: 0.1, tag: `${coil.id}:former` });
  }
  helix(kit, coil.at, coil.halfLength, coil.radius, coil.loopCount, '#b38452', coil.id);
  for (const side of [-1, 1]) {
    kit.box(offset(coil.at, side * coil.halfLength * 0.84, -coil.radius - u * 0.14, -coil.radius * 0.18), u * 0.3, u * 0.34, coil.radius * 0.65, p.green, { tag: `${coil.id}:support` });
    const north = side === coil.northPole;
    kit.label(north ? 'N' : 'S', offset(coil.at, side * (coil.halfLength + u * 0.32), 0, coil.radius * 0.35), { color: north ? p.red : p.blue, size: 13, priority: 4, tag: `${coil.id}:${north ? 'north' : 'south'}` });
  }
  if (kit.visible('fieldLines')) for (const field of view.currentFieldLines || []) {
    annotation(kit.line(field.points || [], field.probe ? p.blue : '#8dada7', { tag: field.id }));
    for (const fraction of field.arrowAt || []) pathArrow(kit, field.points, fraction, p.blue, `${field.id}:arrow`);
  }
  kit.label(coil.currentText, offset(coil.at, -coil.halfLength * 0.5, coil.radius + u * 0.47), { size: 11, priority: 3, tag: `${coil.id}:current` });
  if (kit.visible('fieldLines')) kit.label(coil.fieldText, offset(coil.at, coil.halfLength * 0.6, coil.radius + u * 0.47), { color: p.blue, size: 11, priority: 3, tag: `${coil.id}:field` });
  kit.label(coil.turnsText, offset(coil.at, -coil.halfLength * 0.5, -coil.radius - u * 0.43), { size: 11, priority: 3, tag: `${coil.id}:turns` });
  if (kit.visible('fieldComparison') && coil.comparisonTurnsText) kit.label(coil.comparisonTurnsText, offset(coil.at, coil.halfLength * 0.6, -coil.radius - u * 0.43), { size: 11, color: p.muted, priority: 2, tag: `${coil.id}:comparison-turns` });
}

function drawMotor(view, kit) {
  const rotor = view.currentRotor;
  if (!validPoint(rotor?.at)) return;
  const { palette: p, unit: u } = kit;
  const sides = (rotor.sides || []).filter(validPoint);
  // End-on current-carrying sides remain precisely at the engine's two points.
  if (sides.length === 2) {
    kit.cylinder(sides[0], sides[1], u * 0.07, '#b48755', { tag: `${rotor.id}:cross-member` });
    for (let i = 0; i < sides.length; i += 1) {
      const side = sides[i];
      kit.cylinder(offset(side, 0, 0, -u * 0.8), offset(side, 0, 0, u * 0.18), u * 0.13, '#b48755', { tag: `${rotor.id}:side:${i}` });
    }
    kit.cylinder(offset(sides[0], 0, 0, -u * 0.8), offset(sides[1], 0, 0, -u * 0.8), u * 0.07, '#b48755', { tag: `${rotor.id}:back-member` });
  }
  kit.cylinder(offset(rotor.at, 0, 0, -u), offset(rotor.at, 0, 0, u * 0.3), u * 0.1, p.metal, { tag: `${rotor.id}:axle` });
  kit.cylinder(offset(rotor.at, 0, 0, u * 0.21), offset(rotor.at, 0, 0, u * 0.3), u * 0.23, '#be965d', { tag: `${rotor.id}:commutator` });
  kit.line([offset(rotor.at, 0, -u * 0.23, u * 0.306), offset(rotor.at, 0, u * 0.23, u * 0.306)], p.ink, { tag: `${rotor.id}:commutator-gap` });
  for (const side of [-1, 1]) kit.box(offset(rotor.at, side * u * 0.29, 0, u * 0.25), u * 0.13, u * 0.22, u * 0.13, p.ink, { tag: `${rotor.id}:brush` });
  // The stator's orientation is already carried by its field vectors. Pole
  // bodies surround the rotor but do not add a second, inferred field lattice.
  const statorVector = (view.vectors || []).find(v => v.id?.startsWith('stator-field') && validPoint(v.from) && validPoint(v.to));
  for (const side of [-1, 1]) {
    const at = offset(rotor.at, side * (rotor.halfWidth + u * 2.6));
    kit.box(at, u * 0.85, u * 1.9, u * 0.6, side < 0 ? '#bb847a' : '#7995b4', { tag: `${rotor.id}:stator:${side}` });
    if (statorVector) {
      const fieldRight = statorVector.to.x > statorVector.from.x;
      const north = (side < 0) === fieldRight;
      kit.label(north ? 'N' : 'S', offset(at, 0, 0, u * 0.33), { size: 13, color: '#fffdf5', priority: 4, tag: `${rotor.id}:stator-pole:${side}` });
    }
  }
  if (kit.visible('fieldLines')) {
    const radius = rotor.halfWidth + u * 0.73;
    const points = Array.from({ length: 25 }, (_, i) => {
      const a = (-0.58 + i / 24 * 1.16) * rotor.sense;
      return offset(rotor.at, radius * Math.cos(a), radius * Math.sin(a));
    });
    annotation(kit.line(points, p.green, { tag: `${rotor.id}:rotation-sense` }));
    pathArrow(kit, points, 0.94, p.green, `${rotor.id}:rotation-arrow`);
    // Most snapshots duplicate these forces in the common vector list. Only
    // draw a fallback when the platform does not supply that common layer.
    const vectorIds = new Set((view.vectors || []).map(v => v.id));
    for (const force of rotor.forces || []) if (!vectorIds.has(force.id) && validPoint(force.from) && validPoint(force.to)) kit.arrow(force.from, force.to, p.red, { tag: force.id });
    kit.label([rotor.torqueText, rotor.angleText].filter(Boolean).join(' · '), offset(rotor.at, 0, -u * 2.55), { size: 11, priority: 3, tag: `${rotor.id}:torque` });
  }
  kit.label([rotor.currentText, rotor.turnsText].filter(Boolean).join(' · '), offset(rotor.at, 0, u * 2.58), { size: 11, priority: 3, tag: `${rotor.id}:current` });
}

function drawTransformer(view, kit) {
  const core = view.transformerCore;
  if (!validPoint(core?.from) || !validPoint(core?.to)) return;
  const { palette: p, unit: u } = kit;
  const center = mix(core.from, core.to, 0.5);
  const length = Math.hypot(core.to.x - core.from.x, core.to.y - core.from.y);
  const rotation = Math.atan2(core.to.y - core.from.y, core.to.x - core.from.x) * 180 / Math.PI;
  kit.box(center, length, core.halfHeight * 2, core.halfHeight * 1.4, p.metal, { rotation, tag: core.id });
  for (const shift of [-0.58, 0, 0.58]) kit.line([offset(core.from, 0, core.halfHeight * shift, core.halfHeight * 0.71), offset(core.to, 0, core.halfHeight * shift, core.halfHeight * 0.71)], '#8f9c97', { tag: `${core.id}:laminations` });
  for (const coil of view.transformerCoils || []) {
    if (!validPoint(coil.at)) continue;
    helix(kit, coil.at, coil.halfWidth, coil.halfHeight, coil.turnsLoops, coil.primary ? '#b88351' : '#66918d', coil.id, 0.32);
    kit.label(coil.primary ? '原线圈' : '副线圈', offset(coil.at, 0, coil.halfHeight + u * 0.73), { size: 11, priority: 3, tag: `${coil.id}:role` });
    if (kit.visible('voltage')) kit.label(coil.turnsText, offset(coil.at, 0, coil.halfHeight + u * 0.3), { size: 11, priority: 3, tag: `${coil.id}:turns` });
    if (kit.visible('voltage')) kit.label(coil.voltageText, offset(coil.at, 0, -coil.halfHeight - u * 0.4), { color: p.blue, size: 12, priority: 4, tag: `${coil.id}:voltage` });
    if (kit.visible('current')) kit.label(coil.currentText, offset(coil.at, 0, -coil.halfHeight - u * 0.84), { color: p.orange, size: 11, priority: 3, tag: `${coil.id}:current` });
    for (const side of [-1, 1]) kit.box(offset(coil.at, side * coil.halfWidth * 0.86, -coil.halfHeight - u * 0.12, -u * 0.15), u * 0.28, u * 0.28, u * 0.55, p.green, { tag: `${coil.id}:foot` });
  }
  if (kit.visible('voltage')) kit.label(core.ratioText, offset(center, 0, u * 0.72), { size: 12, priority: 4, tag: `${core.id}:ratio` });
  if (kit.visible('voltage') && kit.visible('current')) kit.label(core.powerText, offset(center, 0, -u * 0.75), { size: 11, priority: 3, tag: `${core.id}:power` });
}

function inductionBar(kit, bar, paired) {
  if (!validPoint(bar.at) || !positive(bar.length)) return;
  const { palette: p, unit: u } = kit;
  const top = offset(bar.at, 0, bar.length / 2), bottom = offset(bar.at, 0, -bar.length / 2);
  kit.cylinder(bottom, top, Math.min(u * 0.07, bar.length * 0.035), paired ? '#af8552' : p.metal, { tag: bar.id });
  for (const at of [top, bottom]) kit.sphere(at, u * 0.09, '#c3a374', { tag: `${bar.id}:contact` });
  kit.label(bar.label, offset(top, 0, u * 0.68), { size: 11, priority: 4, tag: `${bar.id}:label` });
}

function drawInduction(view, kit) {
  const { palette: p, unit: u } = kit;
  const field = view.inductionField;
  if (validPoint(field?.origin) && positive(field.size?.width) && positive(field.size?.height)) {
    const rect = rectOf(offset(field.origin, field.size.width / 2, field.size.height / 2), field.size.width, field.size.height);
    regionPlate(kit, rect, p.blue, field.id);
    magneticGrid(kit, rect, { spacing: u * 0.95, direction: field.marks }, field.id);
  }
  for (const rail of view.inductionRails || []) {
    if (!validPoint(rail.from) || !validPoint(rail.to)) continue;
    kit.cylinder(rail.from, rail.to, u * 0.057, p.metal, { tag: rail.id });
    for (const at of [rail.from, rail.to]) kit.box(offset(at, 0, 0, -u * 0.11), u * 0.28, u * 0.23, u * 0.2, p.green, { tag: `${rail.id}:mount` });
  }
  const resistor = view.inductionResistor;
  if (validPoint(resistor?.at) && positive(resistor.span)) {
    const half = resistor.span / 2;
    const body = Math.min(half * 0.42, u * 0.38);
    kit.cylinder(offset(resistor.at, 0, -half), offset(resistor.at, 0, -body), u * 0.041, p.metal, { tag: `${resistor.id}:lead-bottom` });
    kit.cylinder(offset(resistor.at, 0, body), offset(resistor.at, 0, half), u * 0.041, p.metal, { tag: `${resistor.id}:lead-top` });
    kit.box(resistor.at, u * 0.27, body * 2, u * 0.24, '#d8ccb0', { tag: resistor.id });
    for (const y of [-0.55, -0.15, 0.3, 0.64]) kit.box(offset(resistor.at, 0, body * y, u * 0.125), u * 0.28, body * 0.085, u * 0.014, '#806c50', { tag: `${resistor.id}:band` });
    kit.label(resistor.label, offset(resistor.at, -u * 0.65, 0), { size: 11, priority: 3, tag: `${resistor.id}:label` });
  }
  if (view.inductionBar && kit.visible('barMotion')) inductionBar(kit, view.inductionBar, false);
  for (const bar of view.inductionPairBars || []) inductionBar(kit, bar, true);
  const coil = view.inductionCoil;
  if (validPoint(coil?.at) && positive(coil.diameter)) {
    const radius = coil.diameter / 2;
    // The edge-on loop matches the platform's charge-flow ellipse. Three turns
    // at different depths are apparatus detail, never an inferred turn count.
    const flow = (view.chargeFlows || []).find(item => item.id === 'induction-loop-flow');
    const path = flow?.path?.length > 2 ? flow.path : Array.from({ length: 65 }, (_, i) => {
      const a = Math.PI * 2 * i / 64;
      return offset(coil.at, radius * Math.cos(a), radius * 0.34 * Math.sin(a));
    });
    for (const depth of [-u * 0.05, 0, u * 0.05]) exactWire(kit, path.map(at => offset(at, 0, 0, depth)), Math.min(u * 0.034, radius * 0.06), '#b28350', `${coil.id}:loop`);
    kit.label(coil.label, offset(coil.at, 0, radius * 0.34 + u * 0.45), { size: 12, priority: 4, tag: `${coil.id}:label` });
  }
  const vectorIds = new Set((view.vectors || []).map(vector => vector.id));
  if (kit.visible('force') && kit.visible('forces')) for (const force of view.inductionForceArrows || []) {
    if (vectorIds.has(force.id) || !validPoint(force.at) || !positive(force.length)) continue;
    const to = offset(force.at, force.direction * force.length);
    kit.arrow(force.at, to, p.red, { tag: force.id });
    kit.label(force.label, offset(mix(force.at, to, 0.5), 0, (force.at.y >= 0 ? 1 : -1) * u * 0.35), { color: p.red, size: 11, priority: 3, tag: `${force.id}:label` });
  }
  if (kit.visible('inductionCurrent')) {
    const current = view.inductionCurrent;
    if (validPoint(current?.from) && validPoint(current?.to)) {
      if (current.sign > 0 || current.sign < 0) {
        annotation(kit.arrow(current.sign > 0 ? current.from : current.to, current.sign > 0 ? current.to : current.from, p.orange, { tag: current.id }));
      } else {
        kit.line([current.from, current.to], p.muted, { dashed: true, opacity: 0.5, tag: `${current.id}:zero` });
      }
      kit.label(current.sign === 0 ? 'I = 0' : 'I', offset(mix(current.from, current.to, 0.5), 0, -u * 0.4), { color: p.orange, size: 11, priority: 3, tag: `${current.id}:label` });
    }
    for (const flow of view.chargeFlows || []) {
      if (!Number.isFinite(flow.current) || flow.current === 0 || !Array.isArray(flow.path)) continue;
      const path = flow.current > 0 ? flow.path : [...flow.path].reverse();
      for (const fraction of [0.13, 0.62]) pathArrow(kit, path, fraction, p.orange, `${flow.id}:direction`);
    }
  }
}

export function drawFields(snapshot, kit) {
  const view = snapshot.view;
  if (!view) return;
  drawElectric(view, kit);
  if (view.field) magneticGrid(kit, sceneRect(view), view.field, 'uniform-magnetic-field');
  drawComposite(view, kit);
  drawStraightWire(view, kit);
  drawCoilRig(view, kit);
  drawMotor(view, kit);
  drawTransformer(view, kit);
  drawInduction(view, kit);
}
