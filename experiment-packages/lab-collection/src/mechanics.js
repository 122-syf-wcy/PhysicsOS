// The view owns every physical position. This module only builds apparatus
// around those anchors; no engine, local clock, or trajectory interpolation.
const finite = Number.isFinite;
const point = p => p && finite(p.x) && finite(p.y) && (p.z === undefined || finite(p.z));
const positive = n => finite(n) && n > 0;
const at = (p, x = 0, y = 0, z = 0) => ({ x: p.x + x, y: p.y + y, z: (p.z ?? 0) + z });
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t });
const degrees = radians => radians * 180 / Math.PI;

function local(origin, angle = 0) {
  const c = Math.cos(angle * Math.PI / 180);
  const s = Math.sin(angle * Math.PI / 180);
  return (x = 0, y = 0, z = 0) => at(origin, c * x - s * y, s * x + c * y, z);
}

function plateBetween(a, b, thickness, depth, color, kit, tag) {
  if (!point(a) || !point(b)) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!positive(length)) return;
  kit.box(mix(a, b, 0.5), length, thickness, depth, color, {
    rotation: degrees(Math.atan2(b.y - a.y, b.x - a.x)), tag,
  });
}

function surfaceBetween(a, b, thickness, depth, color, kit, tag) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!positive(length)) return;
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  // The supplied segment is the upper contact surface of the board.
  kit.polygon([a, b, at(b, -nx * thickness, -ny * thickness), at(a, -nx * thickness, -ny * thickness)], depth, color, { tag });
}

function ring(center, radius, wire, color, kit, tag) {
  if (!positive(radius) || !positive(wire)) return;
  const points = Array.from({ length: 41 }, (_, i) => {
    const t = i * Math.PI / 20;
    return at(center, Math.cos(t) * radius, Math.sin(t) * radius);
  });
  kit.tube(points, wire, color, { tag });
}

const finishes = {
  aluminum: { roughness: 0.28, metalness: 0.82 },
  brushed: { roughness: 0.43, metalness: 0.7 },
  brass: { roughness: 0.3, metalness: 0.78 },
  enamel: { roughness: 0.36, metalness: 0.14 },
  rubber: { roughness: 0.88, metalness: 0.02 },
};
const alloy = '#c1cbc9';
const brass = '#b7a471';
const rubber = '#283536';

function detailMesh(geometry, center, color, kit, opts = {}) {
  const T = kit.THREE;
  const material = new T.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.4, metalness: opts.metalness ?? 0.5 });
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(center.x, center.y, center.z ?? 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (opts.tag) mesh.name = opts.tag;
  kit.group.add(mesh);
  return mesh;
}

function torus(center, radius, wire, color, kit, opts = {}) {
  if (!positive(radius) || !positive(wire)) return;
  const mesh = detailMesh(new kit.THREE.TorusGeometry(radius, wire, 8, 36), center, color, kit, opts);
  if (opts.horizontal) mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function disc(center, radius, depth, color, kit, opts = {}) {
  const mesh = detailMesh(new kit.THREE.CylinderGeometry(radius, radius, depth, 32), center, color, kit, opts);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function screw(center, radius, kit, rotation = 0, color = alloy) {
  const p = local(center, rotation);
  disc(p(0, 0, -radius * 0.08), radius * 1.2, radius * 0.13, '#657371', kit, finishes.brushed);
  disc(center, radius, radius * 0.2, color, kit, finishes.aluminum);
  kit.line([p(-radius * 0.52, 0, radius * 0.115), p(radius * 0.52, 0, radius * 0.115)], rubber);
  kit.line([p(0, -radius * 0.32, radius * 0.115), p(0, radius * 0.32, radius * 0.115)], rubber);
}

function topScrew(center, radius, kit) {
  kit.cylinder(at(center, 0, -radius * 0.07), at(center, 0, radius * 0.07), radius, alloy, finishes.aluminum);
  kit.line([at(center, -radius * 0.5, radius * 0.075), at(center, radius * 0.5, radius * 0.075)], rubber);
}

function cart(body, kit, color) {
  const s = body.size;
  const rotation = finite(body.rotation) ? body.rotation : 0;
  const p = local(body.at, rotation);
  // The carriage shell is centred on the given COM. All trim shares its frame.
  kit.box(body.at, 2.76 * s, 1.02 * s, 1.56 * s, color, { ...finishes.enamel, rotation, tag: body.id });
  kit.box(p(0, -0.4 * s), 2.85 * s, 0.2 * s, 1.62 * s, '#495c5b', { ...finishes.enamel, rotation, tag: `${body.id}-chassis` });
  kit.box(p(0, 0.57 * s), 2.61 * s, 0.14 * s, 1.61 * s, alloy, { ...finishes.aluminum, rotation, tag: `${body.id}-deck` });
  kit.box(p(0, 0.654 * s), 1.75 * s, 0.042 * s, 1.12 * s, '#657c75', { ...finishes.rubber, rotation });
  for (const z of [-0.795 * s, 0.795 * s]) {
    kit.box(p(0, 0.29 * s, z), 2.35 * s, 0.18 * s, 0.027 * s, '#cbd2cb', { ...finishes.brushed, rotation });
    kit.box(p(0, 0.43 * s, z), 2.22 * s, 0.035 * s, 0.031 * s, brass, { ...finishes.brass, rotation });
    kit.box(p(0, -0.17 * s, z), 1.28 * s, 0.28 * s, 0.04 * s, '#dae0d8', { ...finishes.enamel, rotation });
  }
  for (const x of [-1.07 * s, 1.07 * s]) {
    for (const y of [-0.19 * s, 0.27 * s]) screw(p(x, y, 0.823 * s), 0.066 * s, kit, rotation);
    for (const z of [-0.53 * s, 0.53 * s]) topScrew(p(x, 0.65 * s, z), 0.062 * s, kit);
  }
  // A threaded attachment socket is hardware only; it adds no force or load.
  kit.cylinder(p(0, 0.674 * s), p(0, 0.76 * s), 0.15 * s, brass, finishes.brass);
  kit.cylinder(p(0, 0.761 * s), p(0, 0.767 * s), 0.072 * s, rubber, finishes.rubber);
  // Exact axle spacing and tyre outer radius: bottom contact stays at local -s.
  for (const x of [-s, s]) {
    kit.cylinder(p(x, -0.66 * s, -1.035 * s), p(x, -0.66 * s, 1.035 * s), 0.075 * s, alloy, finishes.aluminum);
    for (const z of [-0.9 * s, 0.9 * s]) {
      const center = p(x, -0.66 * s, z);
      torus(center, 0.265 * s, 0.075 * s, rubber, kit, { ...finishes.rubber, tag: `${body.id}-wheel` });
      for (const groove of [-0.025, 0.025]) torus(at(center, 0, 0, groove * s), 0.332 * s, 0.004 * s, '#182929', kit, finishes.rubber);
      disc(center, 0.255 * s, 0.12 * s, alloy, kit, finishes.aluminum);
      for (const side of [-1, 1]) {
        disc(at(center, 0, 0, side * 0.065 * s), 0.178 * s, 0.012 * s, '#627676', kit, finishes.brushed);
        torus(at(center, 0, 0, side * 0.068 * s), 0.207 * s, 0.014 * s, '#d9dfd9', kit, finishes.aluminum);
        for (let hole = 0; hole < 5; hole += 1) {
          const theta = hole * Math.PI * 2 / 5;
          disc(at(center, Math.cos(theta) * 0.127 * s, Math.sin(theta) * 0.127 * s, side * 0.075 * s), 0.037 * s, 0.008 * s, rubber, kit, finishes.rubber);
        }
      }
      screw(at(center, 0, 0, 0.084 * s), 0.084 * s, kit, rotation, brass);
    }
  }
  for (const side of [-1, 1]) {
    kit.box(p(side * 1.48 * s, -0.12 * s), 0.19 * s, 0.46 * s, 1.44 * s, rubber, { ...finishes.rubber, rotation, tag: `${body.id}-bumper` });
    for (const z of [-0.47 * s, 0.47 * s]) kit.cylinder(p(side * 1.37 * s, -0.12 * s, z), p(side * 1.5 * s, -0.12 * s, z), 0.085 * s, alloy, finishes.aluminum);
  }
}

function block(body, kit, color, variant) {
  const s = body.size;
  const rotation = finite(body.rotation) ? body.rotation : 0;
  const p = local(body.at, rotation);
  const { palette: c } = kit;
  kit.box(body.at, 2 * s, 2 * s, 1.5 * s, color, { ...finishes.enamel, rotation, tag: body.id });
  // Face strips and screws belong to the object, so they share its rotation.
  kit.box(p(0, 0.73 * s, 0.765 * s), 1.7 * s, 0.1 * s, 0.03 * s, c.metal, { rotation });
  kit.box(p(0, -0.73 * s, 0.765 * s), 1.7 * s, 0.1 * s, 0.03 * s, c.metal, { rotation });
  for (const x of [-0.73 * s, 0.73 * s]) {
    for (const y of [-0.73 * s, 0.73 * s]) kit.sphere(p(x, y, 0.795 * s), 0.055 * s, c.ink);
  }
  if (variant === 'force-composition') {
    kit.box(p(0, 0, 0.79 * s), 1.54 * s, 1.16 * s, 0.065 * s, alloy, { ...finishes.brushed, rotation });
    disc(p(0, 0, 0.86 * s), 0.45 * s, 0.08 * s, '#435956', kit, finishes.enamel);
    torus(p(0, 0, 0.96 * s), 0.3 * s, 0.074 * s, brass, kit, { ...finishes.brass, tag: `${body.id}-attachment-eye` });
    for (const x of [-0.61 * s, 0.61 * s]) for (const y of [-0.42 * s, 0.42 * s]) screw(p(x, y, 0.834 * s), 0.064 * s, kit, rotation);
  }
}

function forceTable(body, view, kit) {
  const u = kit.unit;
  const anchor = body.at;
  const pulls = (view.vectors ?? []).filter(v => v.role === 'force' && point(v.from) && point(v.to)
    && Math.hypot(v.from.x - anchor.x, v.from.y - anchor.y) < u * 1e-6);
  const points = [anchor, ...pulls.map(v => v.to)];
  const left = Math.min(...points.map(p => p.x)) - u * 0.62;
  const right = Math.max(...points.map(p => p.x)) + u * 0.42;
  const bottom = Math.min(...points.map(p => p.y)) - u * 0.62;
  const top = Math.max(...points.map(p => p.y)) + u * 0.42;
  const width = right - left;
  const height = top - bottom;
  const faceZ = (anchor.z ?? 0) - body.size * 0.85;
  const center = { x: (left + right) / 2, y: (bottom + top) / 2, z: faceZ - u * 0.09 };
  kit.box(center, width, height, u * 0.2, '#415957', { ...finishes.enamel, tag: 'force-table-frame' });
  kit.box(at(center, 0, 0, u * 0.106), width - u * 0.12, height - u * 0.12, u * 0.032, '#dce2d7', { roughness: 0.64, metalness: 0.13, tag: 'force-table-face' });
  // Small counterbores give the panel a physical construction without adding
  // coordinate/force claims. Only supplied pull vectors receive fixtures.
  const step = u * 0.235;
  const columns = Math.min(18, Math.floor((width - u * 0.32) / step));
  const rows = Math.min(18, Math.floor((height - u * 0.32) / step));
  for (let ix = 0; ix <= columns; ix += 1) for (let iy = 0; iy <= rows; iy += 1) {
    const p = { x: left + u * 0.16 + ix * step, y: bottom + u * 0.16 + iy * step, z: faceZ + u * 0.036 };
    disc(p, u * 0.017, u * 0.009, '#6e7d77', kit, finishes.brushed);
    disc(at(p, 0, 0, u * 0.006), u * 0.009, u * 0.005, rubber, kit, finishes.rubber);
  }
  for (const x of [left + u * 0.1, right - u * 0.1]) for (const y of [bottom + u * 0.1, top - u * 0.1]) {
    screw({ x, y, z: faceZ + u * 0.054 }, u * 0.045, kit, 0, brass);
  }
  for (const x of [left + u * 0.32, right - u * 0.32]) {
    kit.box({ x, y: bottom - u * 0.09, z: faceZ - u * 0.05 }, u * 0.48, u * 0.16, u * 0.5, rubber, { ...finishes.rubber, tag: 'force-table-foot' });
  }
  for (const pull of pulls) {
    if (!kit.visible(pull.observable)) continue;
    const length = Math.hypot(pull.to.x - pull.from.x, pull.to.y - pull.from.y);
    if (!positive(length)) continue;
    // A taut cord and its anchoring ferrule follow the supplied segment exactly.
    // There are no balancing weights, new arrows, or computed gauge readings.
    kit.cylinder(pull.from, pull.to, u * 0.012, '#b2b8a5', { ...finishes.rubber, tag: `${pull.id}-cord` });
    const end = pull.to;
    kit.cylinder({ x: end.x, y: end.y, z: faceZ + u * 0.06 }, at(end, 0, 0, -u * 0.018), u * 0.045, alloy, finishes.aluminum);
    disc(at(end, 0, 0, -u * 0.04), u * 0.135, u * 0.04, '#60766f', kit, { ...finishes.enamel, tag: `${pull.id}-fixture` });
    torus(at(end, 0, 0, -u * 0.01), u * 0.079, u * 0.018, brass, kit, finishes.brass);
    screw(at(end, 0, 0, u * 0.014), u * 0.031, kit);
  }
}

function hookedWeight(body, kit, color) {
  const s = body.size;
  const p = local(body.at, finite(body.rotation) ? body.rotation : 0);
  const c = kit.palette;
  // A slotted mass stack fits inside the declared two-size body envelope.
  kit.cylinder(p(0, -0.91 * s), p(0, 0.43 * s), 0.66 * s, color, { tag: body.id });
  for (const y of [-0.83, -0.42, -0.01, 0.4]) {
    kit.cylinder(p(0, (y - 0.025) * s), p(0, (y + 0.025) * s), 0.69 * s, c.metal);
  }
  kit.cylinder(p(0, 0.4 * s), p(0, 0.61 * s), 0.075 * s, c.metal);
  ring(p(0, 0.79 * s), 0.18 * s, 0.03 * s, c.metal, kit, `${body.id}-hook`);
}

function satellite(body, kit) {
  const s = body.size;
  const rotation = finite(body.rotation) ? body.rotation : 0;
  const p = local(body.at, rotation);
  const c = kit.palette;
  // A satellite is an apparatus treatment of the given block, not a new orbit.
  kit.box(body.at, 2 * s, 2 * s, 1.3 * s, c.metal, { rotation, tag: body.id });
  kit.box(p(0, 0, 0.68 * s), 1.55 * s, 1.55 * s, 0.09 * s, '#c2ac77', { rotation });
  for (const side of [-1, 1]) {
    kit.cylinder(p(side * s, 0), p(side * 1.25 * s, 0), 0.055 * s, c.metal);
    kit.box(p(side * 1.74 * s, 0), 0.98 * s, 1.45 * s, 0.09 * s, '#526f87', { rotation });
    for (const y of [-0.45, 0, 0.45]) kit.line([p(side * 1.28 * s, y * s, 0.05 * s), p(side * 2.2 * s, y * s, 0.05 * s)], '#b4c7d2');
  }
}

function weighingPlatform(body, snapshot, kit) {
  const s = body.size;
  const a = body.at;
  const c = kit.palette;
  // The pan follows the supplied load; its reading is already derived upstream.
  kit.box(at(a, 0, -s * 1.16), s * 3, s * 0.32, s * 2.1, c.metal, { tag: `${body.id}-scale-pan` });
  kit.box(at(a, 0, -s * 1.48), s * 2.5, s * 0.32, s * 1.8, c.green);
  kit.box(at(a, 0, -s * 1.47, s * 0.92), s * 1.6, s * 0.22, s * 0.04, '#e1e8df');
  const reading = (snapshot.inspector ?? []).flatMap(section => section.derived ?? []).find(row => row.id === 'N');
  if (reading?.value !== undefined) kit.label(`${reading.value} ${reading.unit ?? ''}`.trim(), at(a, 0, -s * 1.5, s * 0.98), { size: 10, priority: 2, tag: 'apparent-weight-reading' });
}

function bodies(view, kit, id, snapshot) {
  const c = kit.palette;
  for (const [index, body] of (view.bodies ?? []).entries()) {
    if (!point(body.at) || !positive(body.size)) continue;
    const color = index % 2 ? c.blue : c.green;
    if (id === 'force-composition' && index === 0) forceTable(body, view, kit);
    if (id === 'circular-orbit' && body.kind === 'block') satellite(body, kit);
    else if (body.kind === 'cart') cart(body, kit, color);
    else if (body.kind === 'weight-hook') hookedWeight(body, kit, c.metal);
    else if (body.kind === 'ball') {
      kit.sphere(body.at, body.size, color, { tag: body.id });
      // A thin contrasting equator helps distinguish the two collision bodies.
      if ((view.bodies?.length ?? 0) > 1) ring(at(body.at, 0, 0, body.size * 0.02), body.size * 1.003, body.size * 0.016, '#d8e2dc', kit, `${body.id}-seam`);
    } else if (body.kind === 'block') block(body, kit, id.startsWith('friction-') ? c.wood : color, id);
    if (id === 'apparent-weight') weighingPlatform(body, snapshot, kit);
    if (body.label) kit.label(body.label, at(body.at, 0, body.size + kit.unit * 0.2, body.size), { tag: `${body.id}-label`, priority: 2 });
  }
}

function precisionRail(ground, kit, view) {
  const u = kit.unit;
  const left = Math.min(ground.from, ground.to);
  const right = Math.max(ground.from, ground.to);
  const width = right - left;
  const x = (left + right) / 2;
  const y = ground.y;
  const carriage = view?.bodies?.find(body => body.kind === 'cart' && positive(body.size));
  const gauge = carriage ? carriage.size * 0.9 : u * 0.28;
  const depth = Math.max(u * 1.08, gauge * 2 + u * 0.34);
  const front = depth / 2;
  // Machined extrusion: recessed web, raised running shoulders and central slot.
  // Every running shoulder's top stays exactly on the supplied ground line.
  kit.box({ x, y: y - u * 0.205, z: 0 }, width, u * 0.35, depth, alloy, { ...finishes.brushed, tag: 'mechanics-ground' });
  kit.box({ x, y: y - u * 0.028, z: 0 }, width - u * 0.07, u * 0.014, gauge * 1.45, '#647b78', { ...finishes.enamel, tag: 'rail-recessed-channel' });
  for (const z of [-gauge, gauge]) {
    kit.box({ x, y: y - u * 0.031, z }, width, u * 0.062, u * 0.12, '#d7dfdc', { ...finishes.aluminum, tag: 'mechanics-rail' });
    kit.box({ x, y: y - u * 0.018, z: z + Math.sign(z) * u * 0.11 }, width - u * 0.09, u * 0.035, u * 0.032, rubber, finishes.rubber);
  }
  for (const z of [-front, front]) {
    for (const rib of [0.075, 0.29, 0.355]) kit.box({ x, y: y - u * rib, z }, width - u * 0.1, u * 0.018, u * 0.024, '#e0e5df', finishes.aluminum);
    kit.box({ x, y: y - u * 0.225, z: z * 1.005 }, width - u * 0.15, u * 0.062, u * 0.014, '#526966', finishes.enamel);
  }
  // An inset ruler uses actual scene x coordinates and the declared tick step.
  const rulerZ = front + u * 0.025;
  kit.box({ x, y: y - u * 0.143, z: rulerZ }, width - u * 0.24, u * 0.12, u * 0.015, '#e6e6d5', { roughness: 0.5, metalness: 0.2, tag: 'rail-ruler' });
  const declaredMajor = view?.tickStep;
  const major = positive(declaredMajor) ? declaredMajor : (positive(view?.grid?.major) ? view.grid.major : u);
  let step = major / 10;
  while (width / step > 180) step *= 2;
  const first = Math.ceil((left + u * 0.14) / step);
  const last = Math.floor((right - u * 0.14) / step);
  let labels = 0;
  for (let i = first; i <= last; i += 1) {
    const tickX = i * step;
    const multiple = tickX / major;
    const full = Math.abs(multiple - Math.round(multiple)) < 1e-7;
    const half = Math.abs(multiple * 2 - Math.round(multiple * 2)) < 1e-7;
    kit.line([{ x: tickX, y: y - u * 0.086, z: rulerZ + u * 0.01 }, { x: tickX, y: y - u * (full ? 0.18 : half ? 0.15 : 0.12), z: rulerZ + u * 0.01 }], '#455550', { tag: full ? 'ruler-major-tick' : 'ruler-minor-tick' });
    if (full && labels < 14) {
      kit.label(String(Number(tickX.toPrecision(6))), { x: tickX, y: y - u * 0.205, z: rulerZ + u * 0.015 }, { color: '#53635d', size: 9, priority: 0, tag: 'rail-ruler-number' });
      labels += 1;
    }
  }
  for (const endX of [left + u * 0.055, right - u * 0.055]) {
    kit.box({ x: endX, y: y - u * 0.205, z: 0 }, u * 0.11, u * 0.36, depth + u * 0.015, '#4d6562', { ...finishes.enamel, tag: 'rail-endcap' });
    for (const level of [0.075, 0.33]) screw({ x: endX, y: y - u * level, z: front + u * 0.022 }, u * 0.026, kit);
  }
  // Two cross-members, four threaded levelling feet and separate elastomer pads.
  for (const t of [0.065, 0.935]) {
    const supportX = left + width * t;
    kit.box({ x: supportX, y: y - u * 0.419, z: 0 }, u * 0.45, u * 0.115, depth * 1.14, '#637b75', { ...finishes.enamel, tag: 'rail-support' });
    for (const z of [-depth * 0.49, depth * 0.49]) {
      kit.cylinder({ x: supportX, y: y - u * 0.445, z }, { x: supportX, y: y - u * 0.655, z }, u * 0.038, alloy, finishes.aluminum);
      kit.cylinder({ x: supportX, y: y - u * 0.495, z }, { x: supportX, y: y - u * 0.553, z }, u * 0.081, brass, finishes.brass);
      for (const level of [0.57, 0.605, 0.64]) torus({ x: supportX, y: y - u * level, z }, u * 0.041, u * 0.008, '#7e928f', kit, { ...finishes.brushed, horizontal: true });
      kit.cylinder({ x: supportX, y: y - u * 0.655, z }, { x: supportX, y: y - u * 0.691, z }, u * 0.116, alloy, finishes.aluminum);
      kit.cylinder({ x: supportX, y: y - u * 0.691, z }, { x: supportX, y: y - u * 0.755, z }, u * 0.137, rubber, { ...finishes.rubber, tag: 'rail-leveling-foot' });
    }
  }
  if (ground.label) kit.label(ground.label, { x: left + width * 0.1, y: y - u * 0.88, z: front }, { color: kit.palette.muted, priority: 0, tag: 'ground-label' });
}

function rail(ground, kit, rough = false, view) {
  if (!ground || !finite(ground.y) || !finite(ground.from) || !finite(ground.to)) return;
  const width = Math.abs(ground.to - ground.from);
  if (!positive(width)) return;
  if (!rough) return precisionRail(ground, kit, view);
  const u = kit.unit;
  const c = kit.palette;
  const x = (ground.from + ground.to) / 2;
  const h = u * 0.1;
  // The exact ground y is the top surface. Thickness grows down, never up.
  kit.box({ x, y: ground.y - h, z: -u * 0.12 }, width, 2 * h, 1.05 * u, rough ? c.wood : '#c6ceca', { tag: 'mechanics-ground' });
  const count = Math.min(32, Math.max(2, Math.floor(width / (u * 0.55))));
  for (let i = 0; i <= count; i += 1) {
    const tickX = ground.from + (ground.to - ground.from) * i / count;
    kit.line([{ x: tickX, y: ground.y + u * 0.002, z: -0.54 * u }, { x: tickX + width / count * 0.35, y: ground.y + u * 0.002, z: 0.34 * u }], '#b99d73', { opacity: 0.65 });
  }
  for (const t of [0.1, 0.9]) {
    const footX = ground.from + (ground.to - ground.from) * t;
    kit.box({ x: footX, y: ground.y - 0.28 * u, z: -0.1 * u }, 0.32 * u, 0.17 * u, 1.34 * u, c.ink);
  }
  if (ground.label) kit.label(ground.label, { x: ground.from + width * 0.12, y: ground.y - 0.54 * u, z: 0.55 * u }, { color: c.muted, priority: 0, tag: 'ground-label' });
}

function ground(view, kit, id) {
  if (!view.ground) return;
  const hasRail = (view.apparatus ?? []).some(a => a.part === 'track-rail');
  if (hasRail || id.startsWith('collision-') || id === 'chase-meeting') {
    rail(view.ground, kit, id.startsWith('friction-'), view);
    return;
  }
  const g = view.ground;
  if (!finite(g.from) || !finite(g.to) || !finite(g.y) || g.from === g.to) return;
  const u = kit.unit;
  kit.box({ x: (g.from + g.to) / 2, y: g.y - u * 0.08, z: -0.2 * u }, Math.abs(g.to - g.from), u * 0.16, u * 1.5, '#d8d7cd', { tag: 'mechanics-ground' });
  kit.line([{ x: g.from, y: g.y, z: 0.56 * u }, { x: g.to, y: g.y, z: 0.56 * u }], kit.palette.muted);
  if (g.label) kit.label(g.label, { x: g.from + Math.abs(g.to - g.from) * 0.12, y: g.y - u * 0.36, z: 0.6 * u }, { color: kit.palette.muted, priority: 0 });
}

function incline(view, kit) {
  const ramp = view.incline;
  if (!ramp || !point(ramp.origin) || !positive(ramp.base) || !finite(ramp.angle)) return;
  const rise = ramp.base * Math.tan(ramp.angle * Math.PI / 180);
  if (!finite(rise)) return;
  const corner = ramp.origin;
  const foot = at(corner, ramp.base);
  const peak = at(corner, 0, rise);
  const u = kit.unit;
  const c = kit.palette;
  if (Math.abs(rise) > u * 1e-6) kit.polygon([corner, foot, peak], u * 0.9, '#c7d4cc', { tag: 'incline-wedge' });
  // Match the bridge's descending surface; body.rotation remains untouched.
  surfaceBetween(peak, foot, u * 0.075, u * 1.1, c.wood, kit, 'incline-surface');
  plateBetween(at(corner, 0, -0.06 * u), at(foot, 0, -0.06 * u), u * 0.12, u * 1.2, c.metal, kit, 'incline-base');
  for (const p of [corner, foot]) kit.box(at(p, 0, -u * 0.17), u * 0.3, u * 0.18, u * 1.2, c.ink);
}

function platform(view, kit) {
  const p = view.platform;
  if (!p || !point(p.at) || !positive(p.width) || !positive(p.height)) return;
  const u = kit.unit;
  kit.box(at(p.at, -p.width / 2, -p.height / 2, -u * 0.2), p.width, p.height, u * 1.4, kit.palette.metal, { tag: 'launch-platform' });
  kit.box(at(p.at, -p.width / 2, -Math.min(p.height, u * 0.025) / 2, -u * 0.2), p.width, Math.min(p.height, u * 0.025), u * 1.42, '#d8e2dc');
}

function spring(view, kit) {
  const spring = view.spring;
  if (!spring || !point(spring.anchor) || !point(spring.end)) return;
  const a = spring.anchor;
  const b = spring.end;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const u = kit.unit;
  const c = kit.palette;
  if (positive(length)) {
    const nx = -dy / length;
    const ny = dx / length;
    const coilRadius = Math.min(u * 0.22, length * 0.12);
    const lead = length * 0.1;
    const points = [at(a)];
    // Fixed winding count: compression changes pitch, not the amount of wire.
    for (let i = 0; i <= 128; i += 1) {
      const t = i / 128;
      const phase = t * Math.PI * 16;
      const endTaper = Math.min(1, t * 16, (1 - t) * 16);
      const center = mix(a, b, (lead + (length - 2 * lead) * t) / length);
      const radial = Math.sin(phase) * coilRadius * endTaper;
      points.push(at(center, nx * radial, ny * radial, Math.cos(phase) * coilRadius * endTaper));
    }
    points.push(at(b));
    kit.tube(points, Math.min(u * 0.023, length * 0.012), c.metal, { tag: spring.id });
  }
  kit.sphere(a, u * 0.055, c.ink, { tag: `${spring.id}-anchor` });
  kit.sphere(b, u * 0.045, c.metal, { tag: `${spring.id}-end` });
  if (spring.axis === 'horizontal') {
    const side = dx < 0 ? -1 : 1;
    kit.box(at(a, -side * 0.04 * u), u * 0.08, u * 0.8, u * 0.75, c.metal, { tag: `${spring.id}-wall` });
    for (const y of [-0.25, 0.25]) kit.sphere(at(a, side * 0.01 * u, y * u, u * 0.39), u * 0.045, c.ink);
  }
  if (kit.visible('guides') && finite(spring.equilibrium)) {
    const rest = spring.axis === 'vertical' ? { x: a.x, y: spring.equilibrium } : { x: spring.equilibrium, y: a.y };
    const across = spring.axis === 'vertical' ? { x: u * 0.3, y: 0 } : { x: 0, y: u * 0.3 };
    kit.line([at(rest, -across.x, -across.y, u * 0.3), at(rest, across.x, across.y, u * 0.3)], c.muted, { dashed: true, tag: `${spring.id}-equilibrium` });
    kit.label('原长参考', at(rest, across.x + u * 0.12, across.y + u * 0.08, u * 0.3), { color: c.muted, priority: 0 });
  }
}

function pendulum(view, kit) {
  const p = view.pendulum;
  if (!p || !point(p.pivot) || !point(p.bob)) return;
  const u = kit.unit;
  const c = kit.palette;
  if (Math.hypot(p.bob.x - p.pivot.x, p.bob.y - p.pivot.y) > 0) kit.cylinder(p.pivot, p.bob, u * 0.018, c.ink, { tag: p.id });
  kit.cylinder(at(p.pivot, 0, 0, -u * 0.15), at(p.pivot, 0, 0, u * 0.13), u * 0.07, c.metal, { tag: `${p.id}-pivot` });
  if (kit.visible('guides') && finite(p.length) && p.length >= 0) {
    kit.line([at(p.pivot, 0, 0, -u * 0.15), at(p.pivot, 0, -p.length, -u * 0.15)], c.muted, { dashed: true, opacity: 0.5, tag: `${p.id}-rest` });
  }
}

function supportClamp(apparatus, kit) {
  const a = apparatus.at;
  const s = apparatus.size;
  const c = kit.palette;
  // The suspension point is the bottom tip of the clamp, not its centre.
  kit.cylinder(at(a, -s * 0.36, s * 0.13, -s * 0.18), at(a, -s * 0.36, s, -s * 0.18), s * 0.065, c.metal, { tag: apparatus.id });
  kit.box(at(a, -s * 0.27, s * 0.26, -s * 0.1), s * 0.38, s * 0.26, s * 0.33, c.green);
  kit.cylinder(at(a, -s * 0.37, s * 0.09), at(a, 0, s * 0.09), s * 0.045, c.metal);
  kit.cylinder(at(a, 0, s * 0.09), a, s * 0.035, c.metal);
  kit.cylinder(at(a, -s * 0.27, s * 0.26, s * 0.08), at(a, -s * 0.27, s * 0.26, s * 0.3), s * 0.035, c.metal);
  kit.box(at(a, -s * 0.27, s * 0.26, s * 0.34), s * 0.22, s * 0.055, s * 0.055, c.ink);
}

function ruler(apparatus, kit) {
  const s = apparatus.size;
  const a = apparatus.at;
  const w = s * 0.085;
  const c = kit.palette;
  kit.box(at(a, 0, -s / 2, -w), w, s, w * 0.3, '#d8cba3', { tag: apparatus.id });
  for (let i = 0; i <= 26; i += 1) {
    const y = -s * i / 26;
    kit.line([at(a, -w / 2, y, -w * 0.8), at(a, -w / 2 + w * (i % 5 === 0 ? 0.8 : 0.45), y, -w * 0.8)], c.muted);
  }
}

function protractor(apparatus, kit) {
  const a = apparatus.at;
  const r = apparatus.size;
  const c = kit.palette;
  const face = at(a, 0, 0, -kit.unit * 0.25);
  const points = [face];
  for (let i = 0; i <= 40; i += 1) points.push(at(face, Math.cos(Math.PI + i * Math.PI / 40) * r, Math.sin(Math.PI + i * Math.PI / 40) * r));
  kit.polygon(points, kit.unit * 0.025, '#d8d8c0', { opacity: 0.3, tag: apparatus.id });
  kit.circle(face, r, c.metal, { start: Math.PI, end: 2 * Math.PI, opacity: 0.7 });
  for (let i = 0; i <= 18; i += 1) {
    const theta = Math.PI + i * Math.PI / 18;
    const inner = r * (i % 3 === 0 ? 0.84 : 0.91);
    kit.line([at(face, Math.cos(theta) * inner, Math.sin(theta) * inner, kit.unit * 0.03), at(face, Math.cos(theta) * r, Math.sin(theta) * r, kit.unit * 0.03)], c.muted);
  }
}

function springScale(apparatus, kit) {
  const a = apparatus.at;
  const s = apparatus.size;
  const sign = apparatus.flip ? 1 : -1;
  const p = (x, y = 0, z = 0) => at(a, sign * x, y, z);
  const c = kit.palette;
  kit.cylinder(a, p(s * 0.42), s * 0.035, c.metal, { tag: `${apparatus.id}-hook` });
  kit.box(p(s * 1.72), s * 2.6, s * 0.67, s * 0.6, c.green, { tag: apparatus.id });
  kit.box(p(s * 1.72, 0, s * 0.305), s * 2.28, s * 0.4, s * 0.015, '#e6ebe3');
  for (let i = 0; i < 11; i += 1) {
    kit.line([p(s * (0.7 + i * 0.2), -s * 0.19, s * 0.32), p(s * (0.7 + i * 0.2), s * (i % 5 === 0 ? 0.06 : -0.04), s * 0.32)], c.muted);
  }
  kit.cylinder(p(s * 3.03), p(s * 3.23), s * 0.04, c.metal);
  ring(p(s * 3.45), s * 0.22, s * 0.04, c.metal, kit, `${apparatus.id}-handle`);
  // Tick engraving only: no invented pointer reading or physical spring stretch.
}

function apparatus(view, kit) {
  for (const a of view.apparatus ?? []) {
    if (!point(a.at) || !positive(a.size)) continue;
    if (a.part === 'support-clamp') supportClamp(a, kit);
    else if (a.part === 'ruler-vertical') ruler(a, kit);
    else if (a.part === 'protractor') protractor(a, kit);
    else if (a.part === 'spring-scale') springScale(a, kit);
    else if (a.part === 'track-rail' && !view.ground && positive(a.width)) rail({ y: a.at.y, from: a.at.x - a.width / 2, to: a.at.x + a.width / 2 }, kit);
  }
}

function lever(view, kit) {
  const b = view.leverBeam;
  const f = view.leverFulcrum;
  const u = kit.unit;
  const c = kit.palette;
  if (f && point(f.at)) {
    kit.polygon([at(f.at), at(f.at, -u * 0.65, -u * 1.25), at(f.at, u * 0.65, -u * 1.25)], u * 0.7, c.green, { tag: f.id });
    kit.cylinder(at(f.at, 0, -u * 1.25), at(f.at, 0, -u * 2.6), u * 0.105, c.metal);
    kit.box(at(f.at, 0, -u * 2.72), u * 2.8, u * 0.24, u * 1.3, c.ink);
    kit.cylinder(at(f.at, 0, 0, -u * 0.52), at(f.at, 0, 0, u * 0.52), u * 0.12, c.metal, { tag: `${f.id}-axle` });
  }
  if (b && point(b.from) && point(b.to)) {
    const length = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y);
    if (positive(length)) {
      plateBetween(b.from, b.to, u * 0.24, u * 0.75, '#b4baa5', kit, b.id);
      const nx = -(b.to.y - b.from.y) / length;
      const ny = (b.to.x - b.from.x) / length;
      // Interpolate the already tilted beam; never apply tilt a second time.
      for (let i = 1; i < 40; i += 1) {
        const p = mix(b.from, b.to, i / 40);
        kit.line([at(p, nx * u * 0.11, ny * u * 0.11, u * 0.385), at(p, nx * u * (i % 5 === 0 ? -0.05 : 0.025), ny * u * (i % 5 === 0 ? -0.05 : 0.025), u * 0.385)], c.muted);
      }
    }
  }
  for (const h of view.leverHangers ?? []) {
    if (!point(h.attach) || !point(h.massAt)) continue;
    kit.cylinder(h.attach, h.massAt, u * 0.024, c.metal, { tag: `${h.id}-hanger` });
    ring(at(h.attach, 0, -u * 0.055, u * 0.44), u * 0.12, u * 0.025, c.metal, kit, `${h.id}-hook`);
    kit.cylinder(at(h.massAt, 0, -u * 0.41), at(h.massAt, 0, u * 0.41), u * 0.44, h.side === 'left' ? c.green : c.blue, { tag: h.id });
    for (const y of [-0.37, -0.12, 0.12, 0.37]) kit.cylinder(at(h.massAt, 0, (y - 0.012) * u), at(h.massAt, 0, (y + 0.012) * u), u * 0.455, c.metal);
    kit.label(h.massText, at(h.massAt, h.side === 'left' ? -u * 0.8 : u * 0.8, -u * 0.2, u * 0.5), { priority: 2, tag: `${h.id}-mass` });
  }
}

function energy(view, kit, id) {
  const r = view.energyRamp;
  const bar = view.energyBar;
  const u = kit.unit;
  const c = kit.palette;
  if (kit.visible('energyConversion') && r && point(r.base) && point(r.peak)) {
    const dx = r.peak.x - r.base.x;
    const dy = r.peak.y - r.base.y;
    const length = Math.hypot(dx, dy);
    if (positive(length)) {
      const tx = dx / length;
      const ty = dy / length;
      const nx = -ty;
      const ny = tx;
      const rotation = degrees(Math.atan2(dy, dx));
      if (Math.abs(dx * dy) > 0) kit.polygon([r.base, r.peak, { x: r.peak.x, y: r.base.y }], u * 0.9, '#ccd7cc', { tag: r.id });
      surfaceBetween(r.base, r.peak, u * 0.065, u * 1.12, id === 'ramp-friction' ? c.wood : c.metal, kit, `${r.id}-surface`);
      if (id === 'ramp-friction') {
        for (let i = 1; i < 24; i += 1) {
          const p = mix(r.base, r.peak, i / 24);
          kit.line([at(p, nx * u * 0.045, ny * u * 0.045, -u * 0.53), at(p, nx * u * 0.045, ny * u * 0.045, u * 0.53)], '#aa8d63');
        }
      }
      if (positive(r.cartLength) && positive(r.cartHalfHeight)) {
        // The visual contract places this cart at release. Only its silhouette
        // is set back on the slope by half its length so it fits the apparatus.
        const center = at(r.peak, -tx * r.cartLength / 2 + nx * r.cartHalfHeight, -ty * r.cartLength / 2 + ny * r.cartHalfHeight);
        const p = local(center, rotation);
        kit.box(center, r.cartLength, r.cartHalfHeight * 2, u * 0.68, c.green, { rotation, tag: `${r.id}-cart` });
        kit.box(p(0, r.cartHalfHeight * 0.55, u * 0.35), r.cartLength * 0.65, r.cartHalfHeight * 0.28, u * 0.025, '#dce8e2', { rotation });
        for (const x of [-0.32, 0.32]) kit.cylinder(p(x * r.cartLength, -r.cartHalfHeight * 0.68, -u * 0.4), p(x * r.cartLength, -r.cartHalfHeight * 0.68, u * 0.4), r.cartHalfHeight * 0.3, c.ink);
      }
    }
    if (kit.visible('energy')) {
      kit.label(r.potentialText, at(r.peak, -u * 0.6, u * 0.7), { color: c.blue, priority: 2, tag: 'release-energy' });
      kit.label(r.kineticText, at(r.base, -u * 0.05, u * 1.05), { color: c.green, priority: 2, tag: 'terminal-energy' });
      kit.label(r.speedText, at(r.base, -u * 0.05, u * 0.62), { color: c.muted, priority: 1 });
    }
  }
  if (!kit.visible('energy') || !bar || !point(bar.at) || !positive(bar.width) || !positive(bar.height)) return;
  const depth = u * 0.16;
  kit.box(at(bar.at, bar.width / 2, bar.height / 2, -depth), bar.width, bar.height, depth, '#dce0d8', { tag: bar.id });
  let cursor = bar.at.x;
  const colors = { potential: c.blue, kinetic: c.green, thermal: c.orange };
  for (const segment of bar.segments ?? []) {
    if (!finite(segment.fraction) || segment.fraction < 0) continue;
    const width = bar.width * segment.fraction;
    // Do not normalize the shares, or give zero energy a visible minimum width.
    if (positive(width)) kit.box({ x: cursor + width / 2, y: bar.at.y + bar.height / 2, z: 0 }, width, bar.height, depth, colors[segment.role] ?? c.muted, { tag: `energy-segment-${segment.id}` });
    cursor += width;
  }
  kit.label(bar.totalText, at(bar.at, bar.width / 2, -u * 0.38, depth), { priority: 2, tag: 'energy-total' });
  for (const [index, segment] of (bar.segments ?? []).entries()) {
    kit.label(segment.text, at(bar.at, bar.width + u * 0.75, bar.height - index * u * 0.5, depth), { color: colors[segment.role] ?? c.muted, priority: 1, tag: `energy-label-${segment.id}` });
  }
}

function motionMarks(view, kit) {
  if (!kit.visible('trajectory')) return;
  for (const mark of view.motionMarks ?? []) {
    if (!point(mark.at)) continue;
    kit.sphere(at(mark.at, 0, 0, -kit.unit * 0.12), kit.unit * 0.034, kit.palette.muted, { opacity: 0.52, tag: mark.id });
    if (mark.label) kit.label(mark.label, at(mark.at, 0, -kit.unit * 0.24, kit.unit * 0.16), { color: kit.palette.muted, priority: 0, tag: `${mark.id}-label` });
  }
}

export function drawMechanics(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  const id = snapshot.experimentId ?? '';
  ground(view, kit, id);
  incline(view, kit);
  platform(view, kit);
  apparatus(view, kit);
  spring(view, kit);
  pendulum(view, kit);
  lever(view, kit);
  energy(view, kit, id);
  motionMarks(view, kit);
  bodies(view, kit, id, snapshot);
}
