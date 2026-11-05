// Optical apparatus. Positions, signed image heights and every ray vertex are
// upstream facts; the small widths below are material/presentation geometry.
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const finite = n => Number.isFinite(n);
const at = (p, dx = 0, dy = 0, z = 0) => ({ x: p.x + dx, y: p.y + dy, z });
const finish = {
  black: '#202b2d', edge: '#3c4849', sage: '#758d80', brass: '#bc9860', steel: '#bdc9cb', ivory: '#f5f1df',
};

function physicalMark(object) {
  object?.traverse(child => {
    child.renderOrder = 12;
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) if (m) {
      m.depthTest = false; m.depthWrite = false;
    }
  });
  return object;
}

function metal(kit, geometry, center, color, tag, roughness = 0.3, metalness = 0.8) {
  const mesh = new kit.THREE.Mesh(geometry, new kit.THREE.MeshStandardMaterial({ color, roughness, metalness }));
  mesh.position.set(center.x, center.y, center.z ?? 0);
  mesh.name = tag; mesh.castShadow = true; mesh.receiveShadow = true;
  kit.group.add(mesh);
  return mesh;
}

// Lathed sections use radial distance and axial x. Rotating the lathe aligns
// its symmetry axis with the optical axis, so every circular face lies in yz.
function axialSection(kit, center, section, color, tag, roughness = 0.3, metalness = 0.8, segments = 64) {
  const geometry = new kit.THREE.LatheGeometry(section.map(([radius, x]) => new kit.THREE.Vector2(radius, x)), segments);
  geometry.rotateZ(-Math.PI / 2);
  return metal(kit, geometry, center, color, tag, roughness, metalness);
}

function ring(kit, center, inner, outer, depth, color, tag) {
  return axialSection(kit, center, [[inner, -depth / 2], [outer, -depth / 2], [outer, depth / 2],
    [inner, depth / 2], [inner, -depth / 2]], color, tag);
}

function knob(kit, center, radius, depth, tag, axis = 'z') {
  const T = kit.THREE;
  const profile = [[radius * 0.86, -depth / 2], [radius, -depth * 0.32], [radius, depth * 0.32], [radius * 0.86, depth / 2], [0, depth / 2]];
  const geometry = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 24);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  else geometry.rotateZ(-Math.PI / 2);
  metal(kit, geometry, center, finish.black, tag, 0.34, 0.65);
  // Eighteen axial flutes are machined geometry rather than a noisy texture.
  for (let i = 0; i < 18; i++) {
    const a = Math.PI * 2 * i / 18, x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (axis === 'z') kit.cylinder(at(center, x, y, (center.z ?? 0) - depth * 0.3),
      at(center, x, y, (center.z ?? 0) + depth * 0.3), radius * 0.026, finish.edge, { tag: `${tag}-knurl` });
    else kit.cylinder({ x: center.x - depth * 0.3, y: center.y + x, z: (center.z ?? 0) + y },
      { x: center.x + depth * 0.3, y: center.y + x, z: (center.z ?? 0) + y }, radius * 0.026, finish.edge, { tag: `${tag}-knurl` });
  }
  if (axis === 'z') {
    kit.cylinder(at(center, 0, 0, (center.z ?? 0) + depth / 2), at(center, 0, 0, (center.z ?? 0) + depth * 0.54), radius * 0.28, finish.brass, { metalness: 0.85 });
  }
}

function screw(kit, center, radius, tag) {
  const z = center.z ?? 0;
  kit.cylinder(at(center, 0, 0, z - radius * 0.24), at(center, 0, 0, z + radius * 0.24), radius, finish.steel, { tag, roughness: 0.22, metalness: 0.85 });
  kit.line([at(center, -radius * 0.6, 0, z + radius * 0.25), at(center, radius * 0.6, 0, z + radius * 0.25)], finish.black);
}

const digitSegments = {
  0: [0, 1, 2, 3, 4, 5], 1: [1, 2], 2: [0, 1, 6, 4, 3], 3: [0, 1, 6, 2, 3],
  4: [5, 6, 1, 2], 5: [0, 5, 6, 2, 3], 6: [0, 5, 6, 4, 2, 3],
  7: [0, 1, 2], 8: [0, 1, 2, 3, 4, 5, 6], 9: [0, 1, 2, 3, 5, 6], '-': [6],
};
function engraving(kit, text, x, y, z, size) {
  const segments = [[[0, 1], [0.55, 1]], [[0.55, 1], [0.55, 0.5]], [[0.55, 0.5], [0.55, 0]],
    [[0.55, 0], [0, 0]], [[0, 0], [0, 0.5]], [[0, 0.5], [0, 1]], [[0, 0.5], [0.55, 0.5]]];
  [...text].forEach((digit, index) => {
    for (const segment of digitSegments[digit] ?? []) {
      kit.line(segments[segment].map(([sx, sy]) => ({ x: x + (index * 0.8 + sx - text.length * 0.4) * size, y, z: z + sy * size })), '#c2c9be', { tag: 'rail-engraving' });
    }
  });
}

function rail(left, right, floor, view, kit, tag = 'optical-bench') {
  const u = kit.unit, middle = (left + right) / 2, length = right - left;
  if (!(length > 0)) return;
  // Black anodized extrusion, paired polished guide edges and recessed T slot.
  kit.box({ x: middle, y: floor - u * 0.15, z: 0 }, length, u * 0.3, u * 1.62, finish.black, { tag, roughness: 0.4, metalness: 0.7 });
  for (const side of [-1, 1]) {
    kit.box({ x: middle, y: floor + u * 0.014, z: side * u * 0.32 }, length - u * 0.12, u * 0.028, u * 0.17, finish.steel, { tag: `${tag}-guide`, roughness: 0.22, metalness: 0.85 });
    kit.box({ x: middle, y: floor - u * 0.17, z: side * u * 0.815 }, length, u * 0.036, u * 0.014, finish.brass, { tag: `${tag}-trim`, roughness: 0.25, metalness: 0.85 });
  }
  kit.box({ x: middle, y: floor + u * 0.01, z: 0 }, length - u * 0.15, u * 0.014, u * 0.14, '#11191b', { tag: `${tag}-slot` });
  for (const x of [left + u * 0.45, right - u * 0.45]) {
    kit.box({ x, y: floor - u * 0.4, z: 0 }, u * 0.85, u * 0.19, u * 1.7, finish.sage, { tag: `${tag}-foot`, roughness: 0.65, metalness: 0.25 });
    for (const side of [-1, 1]) kit.cylinder({ x, y: floor - u * 0.5, z: side * u * 0.62 },
      { x, y: floor - u * 0.56, z: side * u * 0.62 }, u * 0.13, finish.black, { tag: `${tag}-rubber-foot` });
  }
  for (const x of [left, right]) {
    kit.box({ x, y: floor - u * 0.15, z: 0 }, u * 0.09, u * 0.34, u * 1.66, finish.edge, { tag: `${tag}-end-cap` });
    for (const z of [-u * 0.45, u * 0.45]) kit.sphere({ x, y: floor - u * 0.15, z }, u * 0.032, finish.steel);
  }
  // Each mark is placed at its raw scene x. Rail markings are physical hardware
  // and do not replace or rescale the upstream F/2F/measurement overlays.
  const rawStep = view?.tickStep > 0 ? view.tickStep / 10 : u * 0.15;
  const step = Math.max(rawStep, length / 180);
  const first = Math.ceil(left / step), last = Math.floor(right / step);
  for (let i = first; i <= last; i++) {
    const major = i % 5 === 0;
    kit.line([{ x: i * step, y: floor + u * 0.004, z: u * 0.6 },
      { x: i * step, y: floor + u * 0.004, z: u * (major ? 0.43 : 0.51) }], major ? finish.ivory : '#748582', { tag: `${tag}-tick` });
    if (major && Number.isInteger(i * step)) engraving(kit, String(i * step), i * step, floor + u * 0.006, u * 0.68, u * 0.115);
  }
}

function ray(points, color, kit, tag, dashed = false) {
  if (!points?.length || !points.every(point)) return;
  physicalMark(kit.line(points, color, { dashed, tag }));
  if (dashed) return;
  // Direction marks are interpolated ON each supplied physical segment.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const t = 0.57, span = Math.min(0.12, kit.unit * 0.22 / length);
    physicalMark(kit.arrow({ x: a.x + (b.x - a.x) * (t - span), y: a.y + (b.y - a.y) * (t - span) },
      { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, color, { tag: `${tag}-direction-${i}` }));
  }
}

function imageArrow(from, to, color, virtual, kit, tag) {
  if (!point(from) || !point(to)) return;
  if (!virtual) { physicalMark(kit.arrow(from, to, color, { tag })); return; }
  physicalMark(kit.line([from, to], color, { dashed: true, tag }));
  const h = to.y - from.y;
  if (!h) return;
  const head = Math.min(Math.abs(h) * 0.24, kit.unit * 0.22);
  physicalMark(kit.line([at(to, -head * 0.5, -Math.sign(h) * head), to,
    at(to, head * 0.5, -Math.sign(h) * head)], color, { dashed: true, tag: `${tag}-head` }));
}

function stand(x, top, bottom, kit, tag) {
  const u = kit.unit, base = { x, y: bottom, z: 0 };
  kit.box(at(base, 0, u * 0.11), u * 0.8, u * 0.22, u * 1.14, finish.sage, { tag: `${tag}-carriage`, roughness: 0.58, metalness: 0.35 });
  kit.box(at(base, 0, u * 0.23), u * 0.67, u * 0.045, u * 0.85, finish.edge, { tag: `${tag}-carriage-top`, roughness: 0.36, metalness: 0.65 });
  // Side locking wheel clamps the carriage to the rail without shifting its x.
  kit.cylinder(at(base, 0, u * 0.11, u * 0.48), at(base, 0, u * 0.11, u * 0.68), u * 0.045, finish.brass);
  knob(kit, at(base, 0, u * 0.11, u * 0.73), u * 0.125, u * 0.13, `${tag}-carriage-lock`);
  kit.line([at(base, -u * 0.06, u * 0.24, u * 0.43), at(base, 0, u * 0.24, u * 0.55),
    at(base, u * 0.06, u * 0.24, u * 0.43)], finish.ivory, { tag: `${tag}-index` });
  const low = bottom + u * 0.25;
  if (top > low) {
    const collarY = low + Math.min((top - low) * 0.4, u * 0.48);
    kit.cylinder({ x, y: low, z: 0 }, { x, y: top, z: 0 }, u * 0.077, finish.steel, { tag, roughness: 0.17, metalness: 0.95 });
    kit.cylinder({ x, y: low, z: 0 }, { x, y: collarY, z: 0 }, u * 0.115, finish.edge, { tag: `${tag}-sleeve`, roughness: 0.35, metalness: 0.75 });
    kit.cylinder({ x, y: collarY - u * 0.035, z: 0 }, { x, y: collarY + u * 0.035, z: 0 }, u * 0.127, finish.brass, { tag: `${tag}-collar`, metalness: 0.85 });
    knob(kit, { x, y: collarY - u * 0.09, z: u * 0.19 }, u * 0.105, u * 0.16, `${tag}-height-lock`);
  }
}

function screen(screen, floor, kit) {
  if (!point(screen.at) || !finite(screen.halfHeight) || screen.halfHeight <= 0) return;
  const { unit: u } = kit, a = screen.at, h = screen.halfHeight;
  const halfWidth = Math.max(u * 0.7, h * 0.72), frame = Math.min(u * 0.11, h * 0.08);
  // The diffuser is a full yz sheet, perpendicular to the optical axis. Its
  // midplane stays exactly at screen.at.x; the computed image is an overlay.
  kit.box(a, u * 0.035, h * 2, halfWidth * 2, screen.lit && kit.visible('image') ? '#f3f1dc' : '#d9ddd2',
    { opacity: 0.77, roughness: 0.91, metalness: 0, tag: screen.id });
  for (const sign of [-1, 1]) {
    kit.box(at(a, 0, sign * (h + frame / 2)), u * 0.19, frame, halfWidth * 2 + frame * 2, finish.black, { tag: `${screen.id}-horizontal-frame`, roughness: 0.35, metalness: 0.7 });
    kit.box(at(a, 0, 0, sign * (halfWidth + frame / 2)), u * 0.19, h * 2, frame, finish.black, { tag: `${screen.id}-vertical-frame`, roughness: 0.35, metalness: 0.7 });
    for (const z of [-halfWidth, halfWidth]) kit.cylinder({ x: a.x - u * 0.105, y: a.y + sign * h, z },
      { x: a.x - u * 0.13, y: a.y + sign * h, z }, u * 0.028, finish.brass, { tag: `${screen.id}-frame-screw` });
  }
  // Fine center registration marks belong to the diffuser, not invented rays.
  for (const z of [-halfWidth * 0.93, halfWidth * 0.93]) kit.line([{ x: a.x - u * 0.021, y: a.y - u * 0.07, z },
    { x: a.x - u * 0.021, y: a.y + u * 0.07, z }], '#a1aaa1', { tag: `${screen.id}-registration` });
  stand(a.x, a.y - h - frame, floor, kit, `${screen.id}-stand`);
  if (screen.label) kit.label(screen.label, at(a, u * 0.45, h + u * 0.28), { tag: screen.id });
}

function lensMount(e, kit) {
  const a = e.at, h = e.halfAperture;
  // A distant real image can greatly expand scene extent; its presentation
  // unit must not make the retention hardware intrude into the lens aperture.
  const u = Math.min(kit.unit, h);
  const rim = Math.min(u * 0.18, h * 0.16), depth = Math.min(u * 0.3, h * 0.25);
  ring(kit, a, h + u * 0.012, h + rim, depth, finish.black, `${e.id}-mount`);
  for (const x of [-depth * 0.54, depth * 0.54]) ring(kit, at(a, x), h + u * 0.008, h + rim * 0.35, u * 0.035, finish.brass, `${e.id}-retaining-ring`);
  for (let i = 0; i < 12; i++) {
    const angle = Math.PI * 2 * i / 12;
    const center = { x: a.x, y: a.y + Math.cos(angle) * (h + rim * 0.77), z: Math.sin(angle) * (h + rim * 0.77) };
    kit.cylinder({ ...center, x: a.x - depth * 0.55 }, { ...center, x: a.x - depth * 0.63 }, u * 0.022, finish.steel, { tag: `${e.id}-retaining-screw` });
  }
  // External radial adjusters leave the full declared aperture clear.
  for (const sign of [-1, 1]) {
    kit.cylinder(at(a, 0, 0, sign * (h + rim)), at(a, 0, 0, sign * (h + rim + u * 0.12)), u * 0.047, finish.brass);
    knob(kit, at(a, 0, 0, sign * (h + rim + u * 0.19)), u * 0.09, u * 0.13, `${e.id}-centering-${sign}`);
  }
  // Rotationally symmetric biconvex optical glass: true Y and Z aperture radii,
  // with finite center thickness along X. This is not an xy billboard/coin.
  const glass = new kit.THREE.Mesh(new kit.THREE.SphereGeometry(1, 48, 32), new kit.THREE.MeshPhysicalMaterial({
    color: '#d4ebe4', roughness: 0.075, metalness: 0, transparent: true, opacity: 0.42,
    transmission: 0.38, thickness: u * 0.25, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.06,
    side: kit.THREE.DoubleSide, depthWrite: false,
  }));
  glass.position.set(a.x, a.y, 0); glass.scale.set(Math.min(u * 0.3, h * 0.24), h, h);
  glass.name = e.id; glass.castShadow = false; glass.receiveShadow = false; kit.group.add(glass);
}

function candleObject(o, floor, kit) {
  const T = kit.THREE, u = kit.unit, p = o.at, h = o.height;
  const radius = Math.min(u * 0.095, h * 0.08), bodyHeight = h * 0.78;
  const flameHeight = h * 0.2, flameBase = h - flameHeight;
  stand(p.x, p.y - u * 0.12, floor, kit, `${o.id}-stand`);
  kit.cylinder(at(p, 0, -u * 0.15), p, radius * 1.32, finish.brass,
    { tag: `${o.id}-candle-holder`, roughness: 0.26, metalness: 0.8 });
  const waxProfile = [[0, 0], [radius * 0.88, 0], [radius, bodyHeight * 0.025],
    [radius, bodyHeight * 0.95], [radius * 0.95, bodyHeight], [radius * 0.72, bodyHeight],
    [radius * 0.6, bodyHeight * 0.965], [0, bodyHeight * 0.965]];
  const wax = metal(kit, new T.LatheGeometry(waxProfile.map(([r, y]) => new T.Vector2(r, y)), 32),
    p, '#eee5ca', o.id, 0.64, 0);
  // Wax remains opaque; only the flame uses alpha. A pale wax well and two
  // restrained static drips distinguish the candle from an equipment rod.
  wax.material.transparent = false; wax.material.opacity = 1;
  for (const [angle, length] of [[0.65, 0.14], [2.25, 0.09]]) {
    const x = Math.cos(angle) * radius * 0.97, z = Math.sin(angle) * radius * 0.97;
    const end = at(p, x, bodyHeight * (0.95 - length), z);
    kit.cylinder(end, at(p, x, bodyHeight * 0.96, z), radius * 0.055, '#f4ecd5',
      { tag: `${o.id}-wax-drip`, roughness: 0.68, metalness: 0, clearcoat: 0 });
    kit.sphere(end, radius * 0.065, '#f4ecd5', { roughness: 0.68, metalness: 0, clearcoat: 0 });
  }
  kit.cylinder(at(p, 0, bodyHeight * 0.965), at(p, 0, flameBase + flameHeight * 0.16),
    radius * 0.055, '#41382d', { tag: `${o.id}-wick`, roughness: 0.9, metalness: 0 });
  const flameRadius = radius * 0.6;
  const outer = [[0, 0], [0.52, 0.07], [0.96, 0.23], [1, 0.35], [0.72, 0.58], [0.3, 0.82], [0, 1]];
  const flame = new T.Mesh(new T.LatheGeometry(outer.map(([r, y]) => new T.Vector2(r * flameRadius, y * flameHeight)), 24),
    new T.MeshBasicMaterial({ color: '#efb262', transparent: true, opacity: 0.82, depthWrite: false,
      side: T.DoubleSide, toneMapped: false }));
  flame.position.set(p.x, p.y + flameBase, 0);
  flame.name = `${o.id}-flame`; flame.castShadow = false; flame.receiveShadow = false;
  kit.group.add(flame);
  const core = new T.Mesh(new T.LatheGeometry(outer.map(([r, y]) => new T.Vector2(r * flameRadius * 0.5, y * flameHeight * 0.7)), 20),
    new T.MeshBasicMaterial({ color: '#fff0bd', transparent: true, opacity: 0.9, depthWrite: false,
      side: T.DoubleSide, toneMapped: false }));
  core.position.set(p.x, p.y + flameBase + flameHeight * 0.035, 0);
  core.name = `${o.id}-flame-core`; core.castShadow = false; core.receiveShadow = false;
  kit.group.add(core);
  // The last outer profile vertex is exactly (x, at.y + height, z=0), the
  // same luminous tip the platform uses for every principal-ray endpoint.
  if (o.label) kit.label(o.label, at(p, 0, h + u * 0.35), { color: kit.palette.orange, tag: `${o.id}-label` });
}

function illuminatedObject(o, floor, kit) {
  const { unit: u, palette: c } = kit, h = o.height, p = o.at;
  if (!(h > 0)) { imageArrow(p, at(p, 0, h), c.orange, false, kit, o.id); return; }
  if ((o.label ?? '').includes('蜡烛')) { candleObject(o, floor, kit); return; }
  stand(p.x, p.y - u * 0.14, floor, kit, `${o.id}-stand`);
  kit.box(at(p, 0, -u * 0.2), u * 0.46, u * 0.28, u * 0.5, finish.black, { tag: `${o.id}-illuminator`, roughness: 0.34, metalness: 0.65 });
  kit.box(at(p, 0, -u * 0.0185), u * 0.33, u * 0.037, u * 0.41, finish.brass, { tag: `${o.id}-lamp-aperture` });
  const shaft = Math.min(u * 0.085, h * 0.08), head = Math.min(u * 0.28, h * 0.26), neck = h - Math.min(h * 0.22, u * 0.32);
  const arrow = kit.polygon([at(p, -shaft), at(p, shaft), at(p, shaft, neck), at(p, head, neck), at(p, 0, h), at(p, -head, neck), at(p, -shaft, neck)],
    u * 0.105, '#e7bc65', { tag: o.id, roughness: 0.27, metalness: 0.2 });
  if (arrow?.material?.emissive) { arrow.material.emissive.set('#e7a345'); arrow.material.emissiveIntensity = 0.42; }
  screw(kit, at(p, 0, -u * 0.2, u * 0.26), u * 0.032, `${o.id}-lamp-screw`);
  if (o.label) kit.label(o.label, at(p, 0, h + u * 0.35), { color: c.orange, tag: `${o.id}-label` });
}

function opticalBench(view, kit) {
  const { unit: u, palette: c } = kit;
  const elements = view.opticalElements ?? [], screens = view.opticalScreens ?? [];
  const objects = view.opticalObjects ?? [];
  const bottoms = [...elements.filter(e => point(e.at)).map(e => e.at.y - e.halfAperture),
    ...screens.filter(e => point(e.at)).map(e => e.at.y - e.halfHeight)];
  const floor = bottoms.length ? Math.min(...bottoms) - u * 0.48 : view.origin.y + u * 0.5;
  const xs = [...elements, ...screens, ...objects].filter(e => point(e.at)).map(e => e.at.x);
  if (xs.length) {
    const left = Math.min(...xs) - u * 0.65, right = Math.max(...xs) + u * 0.65;
    rail(left, right, floor, view, kit);
  }
  if (elements[0] && point(elements[0].at) && kit.visible('guides')) {
    kit.line([{ x: view.origin.x, y: elements[0].at.y }, { x: view.origin.x + view.extent.width, y: elements[0].at.y }], c.muted, { dashed: true, opacity: 0.5, tag: 'optical-axis' });
  }
  screens.forEach(s => screen(s, floor, kit));
  for (const e of elements) {
    if (!point(e.at) || !finite(e.halfAperture) || e.halfAperture <= 0) continue;
    const a = e.at, h = e.halfAperture;
    if (e.kind === 'thin_lens') {
      lensMount(e, kit);
    } else if (e.kind === 'curved_mirror') {
      const bow = Math.min(h * 0.2, u * 0.42) * (e.curvature === 'convex' ? 1 : -1);
      const surface = Array.from({ length: 25 }, (_, i) => [h * i / 24, bow * (i / 24) ** 2]);
      const section = [...surface, ...surface.toReversed().map(([r, x]) => [r, x + u * 0.085])];
      axialSection(kit, a, section, '#c5d4d4', e.id, 0.11, 0.93);
      ring(kit, at(a, bow + u * 0.03), h + u * 0.008, h + u * 0.14, u * 0.2, finish.black, `${e.id}-mirror-mount`);
      ring(kit, at(a, bow - u * 0.07), h + u * 0.008, h + u * 0.035, u * 0.025, finish.brass, `${e.id}-mirror-bezel`);
      knob(kit, at(a, bow + u * 0.29, 0, h + u * 0.08), u * 0.11, u * 0.16, `${e.id}-tilt-lock`, 'x');
    } else if (e.kind === 'plane_mirror') {
      const halfWidth = h * 0.64;
      kit.box(at(a, u * 0.1), u * 0.2, h * 2 + u * 0.2, halfWidth * 2 + u * 0.2, finish.black, { tag: `${e.id}-back`, roughness: 0.37, metalness: 0.7 });
      kit.box(at(a, u * 0.009), u * 0.018, h * 2, halfWidth * 2, '#c6d6d6', { tag: e.id, roughness: 0.08, metalness: 0.95 });
      for (const y of [-h, h]) kit.box(at(a, -u * 0.022, y), u * 0.035, u * 0.028, halfWidth * 2, finish.brass, { tag: `${e.id}-bezel` });
      knob(kit, at(a, u * 0.27, 0, halfWidth + u * 0.14), u * 0.1, u * 0.14, `${e.id}-tilt-lock`, 'x');
    }
    stand(a.x, a.y - h - u * 0.15, floor, kit, `${e.id}-stand`);
    kit.box(at(a, 0, -h - u * 0.12), u * 0.3, u * 0.16, u * 0.38, finish.edge, { tag: `${e.id}-mount-saddle`, roughness: 0.3, metalness: 0.75 });
    if (e.label) kit.label(e.label, at(a, 0, h + u * 0.35), { tag: e.id });
  }
  for (const o of objects) {
    if (!point(o.at) || !finite(o.height)) continue;
    illuminatedObject(o, floor, kit);
  }
  if (kit.visible('rays')) for (const r of view.opticalRays ?? []) {
    const color = r.kind === 'central' ? c.orange : r.kind === 'focal' ? c.blue : c.green;
    ray(r.points, color, kit, r.id);
    if (r.extension) ray(r.extension, color, kit, `${r.id}-extension`, true);
  }
  if (kit.visible('image')) for (const im of view.opticalImages ?? []) {
    if (!point(im.at) || !finite(im.height)) continue;
    const top = at(im.at, 0, im.height), virtual = im.nature === 'virtual';
    imageArrow(im.at, top, c.purple, virtual, kit, im.id);
    kit.label(`${im.label ?? '像'} · ${virtual ? '虚像' : '实像'}`, at(top, u * 0.2, Math.sign(im.height || 1) * u * 0.32), { color: c.purple, tag: im.id });
  }
  if (kit.visible('guides')) for (const m of view.opticalAxisMarks ?? []) {
    if (!point(m.at)) continue;
    kit.line([at(m.at, 0, -u * 0.07), at(m.at, 0, u * 0.07)], c.muted, { tag: m.id });
    kit.label(m.label, at(m.at, 0, -u * 0.27), { color: c.muted, tag: m.id });
  }
}

function pinhole(r, kit) {
  if (!point(r.at) || !point(r.objectAt) || !point(r.screenAt)) return;
  const { unit: u, palette: c } = kit;
  const floor = r.at.y - Math.max(r.cardHalfHeight, r.screenHalfHeight) - u * 0.55;
  const left = Math.min(r.objectAt.x, r.screenAt.x) - u * 0.55;
  const right = Math.max(r.objectAt.x, r.screenAt.x) + u * 0.55;
  rail(left, right, floor, undefined, kit, `${r.id}-bench`);
  const holeRadius = Math.min(u * 0.09, r.cardHalfHeight * 0.04);
  // The opaque card is a true pierced disk in yz, with one small round hole.
  ring(kit, r.at, holeRadius, r.cardHalfHeight, u * 0.09, finish.black, `${r.id}-card`);
  ring(kit, r.at, r.cardHalfHeight, r.cardHalfHeight + u * 0.12, u * 0.17, finish.edge, `${r.id}-card-rim`);
  ring(kit, at(r.at, -u * 0.052), holeRadius, holeRadius + u * 0.025, u * 0.01, finish.brass, `${r.id}-aperture`);
  stand(r.at.x, r.at.y - r.cardHalfHeight - u * 0.12, floor, kit, `${r.id}-card-stand`);
  screen({ id: `${r.id}-screen`, at: r.screenAt, halfHeight: r.screenHalfHeight, lit: true, label: '光屏' }, floor, kit);
  illuminatedObject({ id: `${r.id}-object`, at: at(r.objectAt, 0, -r.objectHalfHeight), height: r.objectHalfHeight * 2 }, floor, kit);
  if (kit.visible('lightRays')) for (const [i, p] of (r.rays ?? []).entries()) ray(p.points, i ? c.blue : c.orange, kit, p.id);
  // imageFrom is the lower tip, imageTo the upper tail (not arrow order).
  if (kit.visible('image')) imageArrow(r.imageTo, r.imageFrom, c.purple, false, kit, `${r.id}-image`);
  kit.label('小孔', at(r.at, 0, r.cardHalfHeight + u * 0.3), { tag: r.id });
}

function refraction(r, view, kit) {
  if (![r.at, r.boundaryFrom, r.boundaryTo, r.normalFrom, r.normalTo, r.incidentFrom, r.reflectedTo].every(point)) return;
  const { unit: u, palette: c } = kit;
  // Extrude two material slabs perpendicular to the supplied boundary. The
  // normal endpoints select the sides; no angle or refracted path is solved.
  const n = { x: r.normalTo.x - r.normalFrom.x, y: r.normalTo.y - r.normalFrom.y };
  const length = Math.hypot(n.x, n.y);
  if (length) for (const side of [-1, 1]) {
    const depth = Math.min(view.extent.width, view.extent.height) * 0.44;
    const dx = n.x / length * depth * side, dy = n.y / length * depth * side;
    kit.polygon([r.boundaryFrom, r.boundaryTo, at(r.boundaryTo, dx, dy), at(r.boundaryFrom, dx, dy)],
      u * 0.25, side > 0 ? c.glass : '#c7d8d0', { opacity: side > 0 ? 0.22 : 0.13, tag: `${r.id}-medium-${side}` });
  }
  kit.line([r.boundaryFrom, r.boundaryTo], c.metal, { tag: `${r.id}-boundary` });
  if (kit.visible('guides')) kit.line([r.normalFrom, r.normalTo], c.muted, { dashed: true, tag: `${r.id}-normal` });
  if (kit.visible('lightRays')) {
    ray([r.incidentFrom, r.at], c.orange, kit, `${r.id}-incident`);
    ray([r.at, r.reflectedTo], c.purple, kit, `${r.id}-reflected`);
    if (!r.total && point(r.refractedTo)) ray([r.at, r.refractedTo], c.green, kit, `${r.id}-refracted`);
    if (point(r.criticalTo)) ray([r.at, r.criticalTo], c.muted, kit, `${r.id}-critical`, true);
  }
  kit.sphere(r.at, u * 0.045, c.ink, { tag: `${r.id}-incidence` });
  kit.label(r.indicesText, at(r.boundaryFrom, u * 1.4, u * 0.5), { tag: `${r.id}-indices` });
  if (kit.visible('lightRays')) {
    kit.label(r.incidentText, at(r.incidentFrom, u * 0.2, u * 0.3), { color: c.orange });
    if (r.total) kit.label('全反射', at(r.at, u * 0.8, -u * 0.6), { color: c.purple });
  }
}

export function drawOptics(snapshot, kit) {
  const view = snapshot.view;
  if (!view) return;
  if (view.lightRefraction) refraction(view.lightRefraction, view, kit);
  else if (view.lightRig) pinhole(view.lightRig, kit);
  else opticalBench(view, kit);
}
