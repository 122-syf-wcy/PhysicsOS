// Electric, magnetic, composite and induction adapters. Field paths, signs,
// rod motion and force endpoints are facts; apparatus depth adds no dynamics.
import { finite, positive, isPoint, offset, interpolate, distance, radiansToDegrees, scope, entityScope, pathSpan } from './apparatus-geometry.js';
import { apparatusColors as c, finishes, apparatusFrame, bindingTerminal, retainingRing, beam, winding } from './apparatus.js';

function annotation(object) {
  object?.traverse(child => {
    child.renderOrder = 4;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) { material.depthTest = false; material.depthWrite = false; }
  });
  return object;
}

function rectOf(at, width, height) {
  if (!isPoint(at) || !positive(width) || !positive(height)) return;
  return { at, width, height, left: at.x - width / 2, right: at.x + width / 2, bottom: at.y - height / 2, top: at.y + height / 2 };
}
const sceneRect = view => isPoint(view.origin) ? rectOf(offset(view.origin, view.extent?.width / 2, view.extent?.height / 2), view.extent?.width, view.extent?.height) : undefined;

function regionPlate(kit, rect, color, key, label) {
  if (!rect) return;
  scope(kit, key, () => {
    const { at, width, height, left, right, bottom, top } = rect, u = Math.min(kit.unit, width / 3, height / 3), z = at.z ?? 0;
    kit.box(offset(at, 0, 0, -u * 0.16), width, height, u * 0.07, color, { ...finishes.glass, opacity: 0.055, key: 'observation-plane', tag: key });
    kit.line([{ x: left, y: bottom, z }, { x: right, y: bottom, z }, { x: right, y: top, z }, { x: left, y: top, z }, { x: left, y: bottom, z }], color, { opacity: 0.56, key: 'boundary', tag: `${key}:boundary` });
    // A region is a viewing chamber, not a newly simulated source of B or E.
    for (const [side, x] of [['left', left], ['right', right]]) for (const [edge, y] of [['bottom', bottom], ['top', top]]) {
      kit.box({ x, y, z: z - u * 0.12 }, u * 0.075, u * 0.075, u * 0.16, c.alloy, { ...finishes.brushed, key: `clip:${side}:${edge}` });
    }
    kit.label(label, { x: at.x, y: top + u * 0.3, z }, { color: c.ink, size: 11, priority: 3, key: 'label', tag: `${key}:label` });
  });
}

function lattice(rect, spacing, visit) {
  if (!rect || !positive(spacing)) return;
  const columns = Math.max(1, Math.floor(rect.width / spacing)), rows = Math.max(1, Math.floor(rect.height / spacing));
  const stride = Math.max(1, Math.ceil(Math.sqrt(columns * rows / 650)));
  const x0 = rect.at.x - (columns - 1) * spacing / 2, y0 = rect.at.y - (rows - 1) * spacing / 2;
  for (let column = 0; column < columns; column += stride) for (let row = 0; row < rows; row += stride) {
    const at = { x: x0 + column * spacing, y: y0 + row * spacing, z: rect.at.z ?? 0 };
    visit(at, Math.min(spacing, rect.width, rect.height), `station:${column}:${row}`);
  }
}

function electricGrid(kit, rect, field, key) {
  if (!rect || !field || !isPoint(field.direction) || !kit.visible('electricField')) return;
  const { x: dx, y: dy } = field.direction;
  if (dx === 0 && dy === 0) return;
  scope(kit, key, () => lattice(rect, field.spacing, (at, spacing, station) => {
    let half = spacing * 0.3;
    if (dx !== 0) half = Math.min(half, (at.x - rect.left) / Math.abs(dx), (rect.right - at.x) / Math.abs(dx));
    if (dy !== 0) half = Math.min(half, (at.y - rect.bottom) / Math.abs(dy), (rect.top - at.y) / Math.abs(dy));
    if (half > 0) annotation(kit.arrow(offset(at, -dx * half, -dy * half), offset(at, dx * half, dy * half), '#779b89', { key: station, tag: `${key}:${station}` }));
  }));
}

function fieldMark(kit, at, radius, direction, key, color = '#7a94a7', ring = false) {
  if (!positive(radius)) return;
  scope(kit, key, () => {
    if (ring) annotation(kit.circle(at, radius, color, { key: 'ring', tag: `${key}:ring` }));
    if (direction === 'into-page' || direction === 'into' || direction === -1) {
      const half = radius * (ring ? 0.53 : 0.8);
      annotation(kit.line([offset(at, -half, -half), offset(at, half, half)], color, { key: 'cross-diagonal-a', tag: `${key}:into-a` }));
      annotation(kit.line([offset(at, -half, half), offset(at, half, -half)], color, { key: 'cross-diagonal-b', tag: `${key}:into-b` }));
    } else if (direction === 'out-of-page' || direction === 'out' || direction === 1) annotation(kit.sphere(at, radius * 0.27, color, { key: 'dot', tag: `${key}:out` }));
  });
}

function magneticGrid(kit, rect, field, key) {
  if (!rect || !field || !kit.visible('magneticField')) return;
  scope(kit, key, () => lattice(rect, field.spacing, (at, spacing, station) => fieldMark(kit, at, spacing * 0.085, field.direction, station)));
}

function pathMarker(kit, points, fraction, color, key, tag) {
  const marker = pathSpan(points, fraction, kit.unit * 0.38);
  if (marker) annotation(kit.arrow(marker.from, marker.to, color, { key, tag }));
}

function streamline(kit, line, color = '#527d62') {
  if (!Array.isArray(line.points) || line.points.length < 2 || !line.points.every(isPoint)) return;
  entityScope(kit, 'field-streamline', line, () => {
    annotation(kit.line(line.points, color, { opacity: 0.82, key: 'path', tag: line.id }));
    const tip = line.arrowAt;
    if (!isPoint(tip)) return;
    let closest = -1, minimum = Infinity;
    for (let station = 1; station < line.points.length; station += 1) {
      const d = distance(line.points[station], tip);
      if (d < minimum) { minimum = d; closest = station; }
    }
    if (closest < 1) return;
    // Walk backwards through supplied samples; the arrow ends at the exact tip.
    let end = tip, start = tip, remaining = kit.unit * 0.55;
    for (let station = closest - 1; station >= 0 && remaining > 0; station -= 1) {
      const before = line.points[station], length = distance(before, end);
      if (length === 0) continue;
      start = interpolate(end, before, Math.min(1, remaining / length));
      remaining -= length; end = before;
    }
    const arrow = kit.arrow(start, tip, color, { key: 'direction', tag: `${line.id}:arrow` }), length = distance(start, tip);
    arrow?.setLength(length, Math.min(kit.unit * 0.35, length * 0.65), Math.min(kit.unit * 0.25, length * 0.4));
    annotation(arrow);
  });
}

function symmetryStreamlines(view) {
  const source = view.pointChargeSources?.[0];
  if (view.pointChargeSources?.length !== 1 || !isPoint(source?.at)) return [];
  const result = [];
  // A static symmetry display of the SAME single-source engine samples, not an
  // integrated 3D field/trajectory. Never apply it to multiple-source geometry.
  for (const [station, theta] of [['azimuth-60', Math.PI / 3], ['azimuth-120', Math.PI * 2 / 3]]) {
    const rotate = p => ({ x: p.x, y: source.at.y + (p.y - source.at.y) * Math.cos(theta), z: (source.at.z ?? 0) + (p.y - source.at.y) * Math.sin(theta) });
    for (const line of view.fieldStreamlines ?? []) {
      if (!line.points?.every(isPoint) || !isPoint(line.arrowAt) || line.points.some(p => (p.z ?? 0) !== (source.at.z ?? 0))) continue;
      if (line.points.every(p => p.y === source.at.y)) continue;
      result.push({ ...line, id: `${line.id}:symmetry:${station}`, points: line.points.map(rotate), arrowAt: rotate(line.arrowAt) });
    }
  }
  return result;
}

function electric(view, kit, spatial) {
  const u = kit.unit;
  if (kit.visible('electricField')) {
    for (const line of view.fieldStreamlines ?? []) streamline(kit, line);
    if (spatial) for (const line of symmetryStreamlines(view)) streamline(kit, line, '#678799');
  }
  if (kit.visible('equipotentials')) for (const contour of view.equipotentials ?? []) entityScope(kit, 'equipotential', contour, () => {
    const points = contour.points ?? [], path = contour.closed && points.length > 2 ? [...points, points[0]] : points;
    if (path.every(isPoint)) annotation(kit.line(path, '#947fa5', { dashed: true, opacity: 0.57, key: 'contour', tag: contour.id }));
  });
  for (const source of view.pointChargeSources ?? []) if (isPoint(source.at) && positive(source.radius)) entityScope(kit, 'charge-source', source, () => {
    const color = source.sign === 'negative' ? '#5f8197' : '#b87762';
    const body = kit.sphere(source.at, source.radius, color, { ...finishes.enamel, key: 'sphere', tag: source.id });
    if (body) body.userData.apparatus = { factory: 'point-charge-source', origin: offset(source.at), anchors: { chargeCenter: offset(source.at) }, unit: 'scene' };
    kit.label(source.sign === 'negative' ? '−' : source.sign === 'positive' ? '+' : '', offset(source.at, 0, -source.radius - u * 0.15), { size: 13, priority: 5, key: 'polarity', tag: `${source.id}:polarity` });
  });
  if (spatial && kit.visible('electricField') && view.pointChargeSources?.length === 1) {
    const source = view.pointChargeSources[0];
    kit.label(source.sign === 'negative' ? '负电荷 · 同一电场采样的球对称展示' : '正电荷 · 同一电场采样的球对称展示', offset(source.at, 0, u * 3.1), { priority: 3, key: 'symmetry-caption', tag: 'spatial-field-direction' });
  }
  if (isPoint(view.probe?.at)) entityScope(kit, 'probe', view.probe, () => {
    kit.sphere(view.probe.at, u * 0.059, c.rubber, { ...finishes.rubber, key: 'sensor', tag: view.probe.id });
    kit.circle(view.probe.at, u * 0.12, '#738b70', { key: 'registration' });
  });
  for (const plate of view.plates ?? []) if (isPoint(plate.at) && positive(plate.length)) entityScope(kit, 'capacitor-plate', plate, () => {
    const thickness = Math.min(u * 0.09, plate.length * 0.03), f = apparatusFrame(kit, plate.at);
    const object = f.box('plate', [0, 0, 0], plate.length, thickness, u * 0.42, c.alloy, { ...finishes.aluminum, rounded: false, tag: plate.id });
    if (object) object.userData.apparatus = { factory: 'capacitor-plate', origin: offset(plate.at), anchors: { plateCenter: offset(plate.at) }, unit: 'scene' };
    f.box('polarity-strip', [0, 0, u * 0.215], plate.length, thickness * 0.33, u * 0.012, plate.sign === 'negative' ? '#6e90a4' : plate.sign === 'positive' ? '#b77c64' : '#759475', finishes.enamel);
    for (const [side, x] of [['left', -0.43], ['right', 0.43]]) f.box(`standoff:${side}`, [plate.length * x, 0, -u * 0.3], thickness * 0.82, thickness * 0.82, u * 0.2, c.ceramic, finishes.ceramic);
    if (plate.sign) f.label('polarity', plate.sign === 'positive' ? '+' : '−', [0, (plate.top ? 1 : -1) * u * 0.23, u * 0.24], { size: 12, priority: 4, tag: `${plate.id}:polarity` });
  });
  if (view.boundedField) {
    const field = view.boundedField, rect = rectOf(field.at, field.width, field.height);
    if (kit.visible('electricField')) regionPlate(kit, rect, '#6d9477', 'bounded-electric-field');
    electricGrid(kit, rect, field, 'bounded-electric-grid');
  } else if (view.electricField) {
    regionPlate(kit, sceneRect(view), '#8da78a', 'electric-observation-window');
    electricGrid(kit, sceneRect(view), view.electricField, 'uniform-electric-grid');
  }
}

function dee(region, kit) {
  const rect = rectOf(region.at, region.width, region.height);
  if (!rect) return;
  const left = region.id === 'cyclotron-dee-left', inner = left ? rect.right : rect.left, sign = left ? -1 : 1, u = Math.min(kit.unit, region.width);
  const points = Array.from({ length: 49 }, (_, station) => {
    const theta = station * Math.PI / 48;
    return { x: inner + sign * region.width * Math.sin(theta), y: region.at.y + region.height * 0.5 * Math.cos(theta), z: (region.at.z ?? 0) - u * 0.17 };
  });
  kit.polygon(points, u * 0.22, '#9fae8e', { ...finishes.brushed, opacity: 0.42, key: 'dee-body', tag: region.id });
  kit.line([...points, points[0]], '#749169', { key: 'dee-rim' });
  kit.label(left ? '左 D 形盒' : '右 D 形盒', { x: region.at.x, y: rect.top + u * 0.3, z: region.at.z ?? 0 }, { size: 11, priority: 3, key: 'label' });
}

function composite(view, kit) {
  for (const region of view.compositeRegions ?? []) entityScope(kit, 'region', region, () => {
    const rect = rectOf(region.at, region.width, region.height);
    if (!rect) return;
    if (kit.visible('regions')) {
      if (region.id === 'cyclotron-dee-left' || region.id === 'cyclotron-dee-right') dee(region, kit);
      else regionPlate(kit, rect, region.magneticField ? '#8198a0' : '#79997b', 'chamber', region.label);
    }
    electricGrid(kit, rect, region.electricField, 'electric-grid');
    magneticGrid(kit, rect, region.magneticField, 'magnetic-grid');
  });
}

function straightWire(view, kit) {
  const wire = view.currentWire;
  if (!isPoint(wire?.at)) return;
  entityScope(kit, 'current-wire', wire, () => {
    const u = kit.unit;
    kit.cylinder(offset(wire.at, 0, 0, -u * 0.74), offset(wire.at, 0, 0, u * 0.22), u * 0.14, '#b18d59', { ...finishes.brass, key: 'conductor', tag: wire.id });
    retainingRing(kit, offset(wire.at, 0, 0, -u * 0.58), u * 0.145, u * 0.26, u * 0.08, 'insulator', 'z', '#d8d4bb');
    fieldMark(kit, offset(wire.at, 0, 0, u * 0.224), u * 0.12, wire.direction, 'current', c.ink, true);
    kit.label(wire.currentText, offset(wire.at, 0, -u * 0.5), { size: 12, priority: 3, key: 'reading', tag: `${wire.id}:reading` });
  });
  for (const circle of view.currentFieldCircles ?? []) {
    if (!isPoint(circle.center) || !positive(circle.radius) || !kit.visible(circle.id?.includes('comparison') ? 'fieldComparison' : 'fieldLines')) continue;
    entityScope(kit, 'current-field-circle', circle, () => {
      const color = circle.probe ? '#64899e' : '#92ad96';
      annotation(kit.circle(circle.center, circle.radius, color, { key: 'circle', tag: circle.id }));
      if (circle.circulation !== 1 && circle.circulation !== -1) return;
      for (const [station, angle] of [['a', Math.PI * 0.15], ['b', Math.PI * 0.8], ['c', Math.PI * 1.45]]) {
        const delta = Math.min(0.08, kit.unit * 0.11 / circle.radius) * circle.circulation;
        annotation(kit.arrow(offset(circle.center, circle.radius * Math.cos(angle - delta), circle.radius * Math.sin(angle - delta)), offset(circle.center, circle.radius * Math.cos(angle + delta), circle.radius * Math.sin(angle + delta)), color, { key: `circulation:${station}` }));
      }
    });
  }
  for (const probe of view.currentProbes ?? []) if (isPoint(probe.at) && kit.visible(probe.primary ? 'fieldLines' : 'fieldComparison')) entityScope(kit, 'current-probe', probe, () => {
    kit.cylinder(offset(probe.at, 0, 0, -kit.unit * 0.08), offset(probe.at, 0, 0, kit.unit * 0.08), kit.unit * 0.11, c.alloy, { ...finishes.brushed, key: 'sensor', tag: probe.id });
    kit.circle(probe.at, kit.unit * 0.15, '#68876d', { key: 'registration' });
    kit.label(probe.readingText, offset(probe.at, 0, kit.unit * 0.35, kit.unit * 0.1), { size: 12, priority: 4, key: 'reading', tag: `${probe.id}:reading` });
  });
}

function coilRig(view, kit) {
  const coil = view.currentCoil;
  if (!isPoint(coil?.at) || !positive(coil.halfLength) || !positive(coil.radius)) return;
  entityScope(kit, 'coil-rig', coil, () => {
    const u = kit.unit, core = view.currentCore;
    if (isPoint(core?.at) && positive(core.halfLength) && positive(core.halfHeight)) entityScope(kit, 'core', core, () => {
      const f = apparatusFrame(kit, core.at);
      f.box('laminated-core', [0, 0, 0], core.halfLength * 2, core.halfHeight * 2, core.halfHeight * 1.4, c.alloy, { ...finishes.brushed, tag: core.id });
      for (const y of [-0.55, 0.55]) f.line(`lamination:${y}`, [[-core.halfLength, core.halfHeight * y, core.halfHeight * 0.706], [core.halfLength, core.halfHeight * y, core.halfHeight * 0.706]], '#7a8d7c');
      if (core.northPole === 1 || core.northPole === -1) {
        const armature = f.at(core.northPole * (core.halfLength + core.armatureHalfWidth));
        kit.box(armature, core.armatureHalfWidth * 2, core.armatureHalfHeight * 2, core.halfHeight * 1.8, '#4f6352', { ...finishes.brushed, key: 'armature', tag: `${core.id}:armature` });
        if (kit.visible('fieldLines')) {
          kit.label(core.pullText, offset(armature, core.northPole * u * 0.85, u * 0.65), { size: 11, priority: 3, key: 'pull' });
          kit.label(core.heldMassText, offset(armature, core.northPole * u * 0.85, -u * 0.5), { size: 11, priority: 3, key: 'held-mass' });
        }
      }
      kit.label(core.coreText, offset(core.at, 0, -coil.radius - u * 0.8), { size: 11, key: 'permeability' });
      if (kit.visible('fieldLines')) kit.label(core.airFieldText, offset(core.at, 0, coil.radius + u * 0.85), { color: c.muted, size: 10, key: 'air-field' });
      if (kit.visible('fieldComparison')) kit.label([core.comparisonCoreText, core.comparisonPullText].filter(Boolean).join(' · '), offset(core.at, 0, -coil.radius - u * 1.2), { color: c.muted, size: 10, key: 'comparison' });
    });
    winding(kit, coil.at, coil.halfLength, coil.radius, coil.loopCount, { key: 'coil', tag: coil.id, former: !core, flange: true });
    for (const [side, x] of [['left', -coil.halfLength * 0.84], ['right', coil.halfLength * 0.84]]) {
      kit.box(offset(coil.at, x, -coil.radius - u * 0.13), u * 0.28, u * 0.3, coil.radius * 0.67, '#6e876a', { ...finishes.enamel, key: `support:${side}` });
    }
    if (coil.northPole === 1 || coil.northPole === -1) for (const [side, sign] of [['left', -1], ['right', 1]]) kit.label(sign === coil.northPole ? 'N' : 'S', offset(coil.at, sign * (coil.halfLength + u * 0.28), 0, coil.radius * 0.34), { size: 13, priority: 4, key: `pole:${side}` });
    kit.label(coil.currentText, offset(coil.at, -coil.halfLength * 0.5, coil.radius + u * 0.43), { size: 11, priority: 3, key: 'current' });
    kit.label(coil.turnsText, offset(coil.at, -coil.halfLength * 0.5, -coil.radius - u * 0.4), { size: 11, priority: 3, key: 'turns' });
    if (kit.visible('fieldLines')) kit.label(coil.fieldText, offset(coil.at, coil.halfLength * 0.6, coil.radius + u * 0.43), { size: 11, priority: 3, key: 'field' });
    if (kit.visible('fieldComparison')) kit.label(coil.comparisonTurnsText, offset(coil.at, coil.halfLength * 0.6, -coil.radius - u * 0.4), { color: c.muted, size: 11, key: 'comparison-turns' });
  });
  if (kit.visible('fieldLines')) for (const field of view.currentFieldLines ?? []) entityScope(kit, 'coil-field-line', field, () => {
    if (!field.points?.every(isPoint)) return;
    annotation(kit.line(field.points, field.probe ? '#668ba0' : '#89a694', { key: 'path', tag: field.id }));
    for (const fraction of field.arrowAt ?? []) if (finite(fraction)) pathMarker(kit, field.points, fraction, '#668ba0', `arrow:${fraction}`, `${field.id}:arrow:${fraction}`);
  });
}

function motor(view, kit) {
  const rotor = view.currentRotor;
  if (!isPoint(rotor?.at)) return;
  entityScope(kit, 'motor', rotor, () => {
    const u = kit.unit, sides = rotor.sides ?? [];
    if (sides.length === 2 && sides.every(isPoint)) {
      kit.cylinder(sides[0], sides[1], u * 0.06, '#b38d56', { ...finishes.brass, key: 'coil-front', tag: `${rotor.id}:cross-member` });
      for (const [side, at] of [['a', sides[0]], ['b', sides[1]]]) kit.cylinder(offset(at, 0, 0, -u * 0.8), offset(at, 0, 0, u * 0.16), u * 0.11, '#b38d56', { ...finishes.brass, key: `coil-side:${side}`, tag: `${rotor.id}:side:${side}` });
      kit.cylinder(offset(sides[0], 0, 0, -u * 0.8), offset(sides[1], 0, 0, -u * 0.8), u * 0.06, '#b38d56', { ...finishes.brass, key: 'coil-back' });
    }
    kit.cylinder(offset(rotor.at, 0, 0, -u), offset(rotor.at, 0, 0, u * 0.29), u * 0.084, c.alloy, { ...finishes.aluminum, key: 'axle', tag: `${rotor.id}:axle` });
    kit.cylinder(offset(rotor.at, 0, 0, u * 0.2), offset(rotor.at, 0, 0, u * 0.29), u * 0.21, c.brass, { ...finishes.brass, key: 'commutator' });
    const split = apparatusFrame(kit, rotor.at, finite(rotor.angle) ? rotor.angle : 0, 'rad');
    if (split) split.line('commutator-gap', [[0, -u * 0.21, u * 0.296], [0, u * 0.21, u * 0.296]], c.rubber);
    for (const side of [-1, 1]) kit.box(offset(rotor.at, side * u * 0.26, 0, u * 0.25), u * 0.12, u * 0.2, u * 0.12, c.rubber, { ...finishes.rubber, key: `brush:${side}` });
    // Pole orientation consumes its own semantic direction, never a display
    // vector's endpoints or a magnitude recovered from an arrow length.
    const direction = rotor.statorDirection, validDirection = isPoint(direction) && Math.hypot(direction.x, direction.y) > 0;
    if (positive(rotor.halfWidth)) {
      const f = apparatusFrame(kit, rotor.at, validDirection ? radiansToDegrees(Math.atan2(direction.y, direction.x)) : 0);
      for (const [pole, side] of [['north', -1], ['south', 1]]) {
        f.box(`stator:${pole}`, [side * (rotor.halfWidth + u * 2.35), 0, -u * 0.1], u * 0.75, u * 1.76, u * 0.66, validDirection ? (side < 0 ? '#b58a73' : '#819ba5') : '#84917c', { ...finishes.enamel, tag: `${rotor.id}:stator:${pole}` });
        if (validDirection) f.label(`pole:${pole}`, side < 0 ? 'N' : 'S', [side * (rotor.halfWidth + u * 2.35), 0, u * 0.25], { color: c.ink, size: 13, priority: 4 });
      }
      const bedY = -rotor.halfWidth - u * 0.5;
      f.box('stator-bed', [0, bedY, -u * 0.55], rotor.halfWidth * 2 + u * 5.1, u * 0.16, u * 1.35, '#78916e', finishes.enamel);
      for (const [bearing, z] of [['rear', -u * 0.91], ['middle', -u * 0.65]]) f.rod(`bearing:${bearing}`, [0, bedY + u * 0.08, z], [0, -u * 0.2, z], u * 0.085, c.alloy, finishes.brushed);
    }
    if (kit.visible('fieldLines')) {
      // This is a static torque-direction mark, only if the real torque is
      // nonzero. sense is NOT angular velocity; no local rotation or timer.
      if (finite(rotor.torque) && rotor.torque !== 0 && positive(rotor.halfWidth)) {
        const radius = rotor.halfWidth + u * 0.7, sign = Math.sign(rotor.torque);
        const points = Array.from({ length: 25 }, (_, station) => {
          const angle = (-0.58 + station / 24 * 1.16) * sign;
          return offset(rotor.at, radius * Math.cos(angle), radius * Math.sin(angle));
        });
        annotation(kit.line(points, '#6f926c', { key: 'torque-sense', tag: `${rotor.id}:rotation-sense` }));
        pathMarker(kit, points, 0.91, '#6f926c', 'torque-arrow', `${rotor.id}:rotation-arrow`);
      }
      const vectorIds = new Set((view.vectors ?? []).map(item => item.id));
      for (const force of rotor.forces ?? []) if (!vectorIds.has(force.id) && isPoint(force.from) && isPoint(force.to)) entityScope(kit, 'rotor-force', force, () => annotation(kit.arrow(force.from, force.to, '#b87762', { key: 'vector', tag: force.id })));
      kit.label([rotor.torqueText, rotor.angleText].filter(Boolean).join(' · '), offset(rotor.at, 0, -u * 2.46), { size: 11, priority: 3, key: 'torque-reading', tag: `${rotor.id}:torque` });
    }
    kit.label([rotor.currentText, rotor.turnsText].filter(Boolean).join(' · '), offset(rotor.at, 0, u * 2.5), { size: 11, priority: 3, key: 'current-reading' });
  });
}

function transformer(view, kit) {
  const core = view.transformerCore;
  if (!isPoint(core?.from) || !isPoint(core.to) || !positive(core.halfHeight)) return;
  entityScope(kit, 'transformer', core, () => {
    const center = interpolate(core.from, core.to, 0.5), length = distance(core.from, core.to), u = kit.unit;
    if (length <= 0) return;
    beam(kit, core.from, core.to, core.halfHeight * 2, core.halfHeight * 1.4, c.alloy, { key: 'core', tag: core.id });
    const angle = radiansToDegrees(Math.atan2(core.to.y - core.from.y, core.to.x - core.from.x)), f = apparatusFrame(kit, center, angle);
    for (const y of [-0.58, 0, 0.58]) f.line(`lamination:${y}`, [[-length / 2, core.halfHeight * y, core.halfHeight * 0.706], [length / 2, core.halfHeight * y, core.halfHeight * 0.706]], '#7e907e');
    for (const coil of view.transformerCoils ?? []) if (isPoint(coil.at)) entityScope(kit, 'transformer-coil', coil, () => {
      winding(kit, coil.at, coil.halfWidth, coil.halfHeight, coil.turnsLoops, { key: 'winding', tag: coil.id, color: coil.primary ? '#b08850' : '#72958a', depthRatio: 0.72, flange: true, rotation: angle });
      const local = apparatusFrame(kit, coil.at, angle);
      local.label('role', coil.primary ? '原线圈' : '副线圈', [0, coil.halfHeight + u * 0.7, 0], { size: 11, priority: 3 });
      if (kit.visible('voltage')) {
        local.label('turns', coil.turnsText, [0, coil.halfHeight + u * 0.28, 0], { size: 11, priority: 3 });
        local.label('voltage', coil.voltageText, [0, -coil.halfHeight - u * 0.37, 0], { size: 12, priority: 4 });
      }
      if (kit.visible('current')) local.label('current', coil.currentText, [0, -coil.halfHeight - u * 0.79, 0], { size: 11, priority: 3 });
      for (const side of [-1, 1]) local.box(`foot:${side}`, [side * coil.halfWidth * 0.83, -coil.halfHeight - u * 0.12, 0], u * 0.26, u * 0.26, coil.halfHeight * 0.8, '#728d6d', finishes.enamel);
    });
    if (kit.visible('voltage')) kit.label(core.ratioText, offset(center, 0, u * 0.69), { size: 12, priority: 4, key: 'ratio' });
    if (kit.visible('voltage') && kit.visible('current')) kit.label(core.powerText, offset(center, 0, -u * 0.72), { size: 11, priority: 3, key: 'power' });
  });
}

function inductionBar(bar, kit) {
  if (!isPoint(bar?.at) || !positive(bar.length)) return;
  entityScope(kit, 'induction-bar', bar, () => {
    const u = kit.unit, top = offset(bar.at, 0, bar.length / 2), bottom = offset(bar.at, 0, -bar.length / 2);
    kit.cylinder(bottom, top, Math.min(u * 0.057, bar.length * 0.03), '#ac8955', { ...finishes.brass, key: 'conductor', tag: bar.id });
    bindingTerminal(kit, top, Math.min(u * 0.075, bar.length * 0.045), '#c0ad78', 'contact:top');
    bindingTerminal(kit, bottom, Math.min(u * 0.075, bar.length * 0.045), '#c0ad78', 'contact:bottom');
    kit.label(bar.label, offset(top, 0, u * 0.62), { size: 11, priority: 4, key: 'label' });
  });
}

function induction(view, kit) {
  const u = kit.unit, field = view.inductionField;
  if (isPoint(field?.origin) && positive(field.size?.width) && positive(field.size?.height)) entityScope(kit, 'induction-field', field, () => {
    const rect = rectOf(offset(field.origin, field.size.width / 2, field.size.height / 2), field.size.width, field.size.height);
    regionPlate(kit, rect, '#8098a1', 'chamber');
    magneticGrid(kit, rect, { spacing: u * 0.95, direction: field.marks }, 'field-marks');
  });
  for (const rail of view.inductionRails ?? []) if (isPoint(rail.from) && isPoint(rail.to)) entityScope(kit, 'induction-rail', rail, () => {
    kit.cylinder(rail.from, rail.to, u * 0.048, c.alloy, { ...finishes.aluminum, key: 'rail', tag: rail.id });
    for (const [end, p] of [['from', rail.from], ['to', rail.to]]) kit.box(offset(p, 0, 0, -u * 0.1), u * 0.24, u * 0.2, u * 0.18, '#6e8669', { ...finishes.enamel, key: `mount:${end}` });
  });
  const resistor = view.inductionResistor;
  if (isPoint(resistor?.at) && positive(resistor.span)) entityScope(kit, 'induction-resistor', resistor, () => {
    const half = resistor.span / 2, body = Math.min(half * 0.42, u * 0.37), f = apparatusFrame(kit, resistor.at);
    f.rod('lead:bottom', [0, -half, 0], [0, -body, 0], u * 0.035, c.alloy, finishes.aluminum);
    f.rod('lead:top', [0, body, 0], [0, half, 0], u * 0.035, c.alloy, finishes.aluminum);
    f.rod('ceramic', [0, -body, 0], [0, body, 0], u * 0.13, '#ded4b7', { ...finishes.ceramic, tag: resistor.id });
    for (const y of [-0.55, -0.15, 0.3, 0.64]) f.rod(`band:${y}`, [0, body * y - body * 0.03, 0], [0, body * y + body * 0.03, 0], u * 0.133, '#897345', finishes.brass);
    f.label('label', resistor.label, [-u * 0.62, 0, 0], { size: 11, priority: 3 });
  });
  if (view.inductionBar && kit.visible('barMotion')) inductionBar(view.inductionBar, kit);
  for (const bar of view.inductionPairBars ?? []) inductionBar(bar, kit);
  const coil = view.inductionCoil;
  if (isPoint(coil?.at) && positive(coil.diameter)) entityScope(kit, 'induction-coil', coil, () => {
    const flow = (view.chargeFlows ?? []).find(item => item.id === 'induction-loop-flow'), radius = coil.diameter / 2;
    const points = flow?.path?.length > 2 && flow.path.every(isPoint) ? flow.path : Array.from({ length: 65 }, (_, station) => {
      const angle = station * Math.PI / 32;
      return offset(coil.at, radius * Math.cos(angle), radius * 0.34 * Math.sin(angle), radius * Math.sqrt(1 - 0.34 ** 2) * Math.sin(angle));
    });
    // One loop glyph. Never imply three electrical turns from decorative depth.
    kit.tube(points, Math.min(u * 0.027, radius * 0.05), '#b18c57', { ...finishes.brass, curve: 'polyline', key: 'loop', tag: coil.id });
    kit.label(coil.label, offset(coil.at, 0, radius * 0.34 + u * 0.4), { size: 12, priority: 4, key: 'label' });
  });
  const vectorIds = new Set((view.vectors ?? []).map(item => item.id));
  if (kit.visible('force') && kit.visible('forces')) for (const force of view.inductionForceArrows ?? []) if (!vectorIds.has(force.id) && isPoint(force.at) && positive(force.length) && finite(force.direction)) entityScope(kit, 'induction-force', force, () => {
    const to = offset(force.at, force.direction * force.length);
    annotation(kit.arrow(force.at, to, '#b97a62', { key: 'vector', tag: force.id }));
    kit.label(force.label, offset(interpolate(force.at, to, 0.5), 0, (force.at.y >= 0 ? 1 : -1) * u * 0.32), { size: 11, priority: 3, key: 'label' });
  });
  if (kit.visible('inductionCurrent')) {
    const current = view.inductionCurrent;
    if (isPoint(current?.from) && isPoint(current.to) && finite(current.sign)) entityScope(kit, 'induction-current', current, () => {
      if (current.sign !== 0) annotation(kit.arrow(current.sign > 0 ? current.from : current.to, current.sign > 0 ? current.to : current.from, '#b08b45', { key: 'direction', tag: current.id }));
      else kit.line([current.from, current.to], c.muted, { dashed: true, opacity: 0.5, key: 'zero', tag: `${current.id}:zero` });
      kit.label(current.sign === 0 ? 'I = 0' : 'I', offset(interpolate(current.from, current.to, 0.5), 0, -u * 0.35), { size: 11, priority: 3, key: 'label' });
    });
    for (const flow of view.chargeFlows ?? []) if (finite(flow.current) && flow.current !== 0 && Array.isArray(flow.path)) entityScope(kit, 'induction-flow', flow, () => {
      const points = flow.current > 0 ? flow.path : flow.path.slice().reverse();
      for (const fraction of [0.13, 0.62]) pathMarker(kit, points, fraction, '#b08b45', `marker:${fraction}`, `${flow.id}:direction:${fraction}`);
    });
  }
}

export function drawFields(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'fields', () => {
    electric(view, kit, snapshot.experimentId === 'point-charge');
    if (view.field) {
      regionPlate(kit, sceneRect(view), '#879ca3', 'magnetic-observation-window');
      magneticGrid(kit, sceneRect(view), view.field, 'uniform-magnetic-grid');
    }
    composite(view, kit); straightWire(view, kit); coilRig(view, kit); motor(view, kit); transformer(view, kit); induction(view, kit);
  });
}
