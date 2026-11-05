// Fluids, thermal physics and photoelectric apparatus. All measured levels,
// contact widths, fractions and particle positions are snapshot facts.
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const finite = n => Number.isFinite(n);
const at = (p, dx = 0, dy = 0, z = 0) => ({ x: p.x + dx, y: p.y + dy, z });

function vessel(left, right, floor, top, depth, kit, tag) {
  if (![left, right, floor, top, depth].every(finite) || right <= left || top <= floor || depth <= 0) return;
  const { unit: u, palette: c } = kit, middle = (left + right) / 2;
  for (const x of [left, right]) {
    kit.box({ x, y: (floor + top) / 2, z: -depth * 0.15 }, u * 0.05, top - floor, depth, c.glass, { opacity: 0.24, tag: `${tag}-wall` });
    kit.line([{ x, y: top, z: depth * 0.36 }, { x, y: floor, z: depth * 0.36 }], c.metal, { opacity: 0.8 });
  }
  kit.box({ x: middle, y: floor - u * 0.035, z: -depth * 0.15 }, right - left, u * 0.07, depth, c.glass, { opacity: 0.38, tag: `${tag}-floor` });
  kit.line([{ x: left, y: floor, z: depth * 0.36 }, { x: right, y: floor, z: depth * 0.36 }], c.metal);
  // The rear sheet and two open rims convey a transparent laboratory vessel.
  kit.box({ x: middle, y: (floor + top) / 2, z: -depth * 0.65 }, right - left, top - floor, u * 0.025, c.glass, { opacity: 0.08, tag: `${tag}-rear` });
  for (const x of [left, right]) kit.line([{ x, y: top, z: -depth * 0.65 }, { x, y: top, z: depth * 0.36 }], c.metal, { opacity: 0.8 });
}

function liquidTank(t, kit, comparison = false) {
  if (!t || ![t.left, t.right, t.floor, t.surface].every(finite)) return;
  const { unit: u, palette: c } = kit, width = t.right - t.left;
  if (width <= 0) return;
  const depth = Math.min(width * 0.45, u * 2.4), height = t.surface - t.floor;
  const rim = finite(t.rim) ? t.rim : u * 0.8;
  vessel(t.left, t.right, t.floor, t.surface + rim, depth, kit, t.id);
  if (height > 0) kit.box({ x: (t.left + t.right) / 2, y: (t.surface + t.floor) / 2, z: -depth * 0.15 },
    width, height, depth * 0.96, comparison ? '#b9c8a4' : c.glass, { opacity: 0.22, tag: `${t.id}-liquid` });
  kit.line([{ x: t.left, y: t.surface }, { x: t.right, y: t.surface }], comparison ? c.green : c.blue, { opacity: 0.75, tag: `${t.id}-surface` });
  const text = t.densityText ?? t.label;
  if (text) kit.label(text, { x: (t.left + t.right) / 2, y: t.surface + rim + u * 0.3 }, { color: c.muted, tag: `${t.id}-label` });
}

function dial(center, radius, fraction, kit, tag) {
  const c = kit.palette;
  kit.cylinder(at(center, 0, 0, -radius * 0.2), at(center, 0, 0, radius * 0.2), radius, c.metal, { tag });
  kit.cylinder(at(center, 0, 0, radius * 0.205), at(center, 0, 0, radius * 0.22), radius * 0.87, '#f8f6ed');
  for (let i = 0; i <= 8; i++) {
    const angle = Math.PI * (1.2 - i * 1.4 / 8);
    kit.line([at(center, Math.cos(angle) * radius * 0.67, Math.sin(angle) * radius * 0.67, radius * 0.24),
      at(center, Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8, radius * 0.24)], c.muted);
  }
  if (finite(fraction)) {
    const angle = Math.PI * (1.2 - fraction * 1.4);
    kit.line([at(center, 0, 0, radius * 0.26), at(center, Math.cos(angle) * radius * 0.62, Math.sin(angle) * radius * 0.62, radius * 0.26)], c.orange, { tag: `${tag}-needle` });
    kit.sphere(at(center, 0, 0, radius * 0.27), radius * 0.065, c.ink);
  }
}

function buoyancy(v, kit) {
  const { unit: u, palette: c } = kit;
  liquidTank(v.fluidLiquid, kit);
  const b = v.fluidBlock, s = v.fluidScale;
  if (b && point(b.at) && b.halfWidth > 0 && b.halfHeight > 0) {
    const depth = b.halfWidth * 1.5;
    kit.box(b.at, b.halfWidth * 2, b.halfHeight * 2, depth, b.phase === 'floating' ? c.wood : c.metal, { tag: b.id });
    // The highlight ends at the engine's submergedTop, including exactly dry.
    const bottom = b.at.y - b.halfHeight;
    if (kit.visible('displaced') && finite(b.submergedTop) && b.submergedTop > bottom) {
      const height = b.submergedTop - bottom;
      kit.box({ x: b.at.x, y: bottom + height / 2, z: depth / 2 + u * 0.015 }, b.halfWidth * 2, height, u * 0.025, c.blue,
        { opacity: 0.55, tag: `${b.id}-displaced` });
      kit.line([{ x: b.at.x - b.halfWidth, y: b.submergedTop, z: depth / 2 + u * 0.035 },
        { x: b.at.x + b.halfWidth, y: b.submergedTop, z: depth / 2 + u * 0.035 }], c.blue, { tag: `${b.id}-submerged-level` });
    }
    if (b.label) kit.label(b.label, at(b.at, -b.halfWidth - u * 0.4, 0), { tag: `${b.id}-label` });
    if (s && point(s.at)) {
      kit.line([s.at, at(b.at, 0, b.halfHeight)], c.ink, { tag: `${s.id}-suspension` });
      kit.circle(at(b.at, 0, b.halfHeight + u * 0.06), u * 0.07, c.metal);
    }
  }
  if (s && point(s.at)) {
    const center = at(s.at, 0, u * 0.5);
    dial(center, u * 0.46, s.dialFraction, kit, s.id);
    kit.cylinder(s.at, at(center, 0, -u * 0.4), u * 0.045, c.metal);
    kit.circle(at(center, 0, u * 0.57), u * 0.11, c.metal, { tag: `${s.id}-mount` });
    kit.label(s.reading, at(center, u * 0.8, 0), { color: c.orange, tag: `${s.id}-reading` });
  }
}

function solidPressure(s, kit) {
  if (!s || !point(s.at) || !(s.halfHeight > 0)) return;
  const { unit: u, palette: c } = kit;
  for (const f of s.faces ?? []) {
    if (!point(f.at) || !(f.halfWidth > 0)) continue;
    if (!f.loaded && !kit.visible('pressureComparison')) continue;
    const width = f.halfWidth * 2;
    // Both horizontal directions use the supplied contact-face side length;
    // the footprint therefore preserves the stated square-root area ratio.
    kit.box(at(f.at, 0, -s.plateDepth / 2), width, s.plateDepth, width, '#ccd6cb', { tag: `${f.id}-plate` });
    const center = f.loaded ? s.at : at(f.at, 0, s.halfHeight);
    kit.box(center, width, s.halfHeight * 2, width, f.loaded ? c.green : '#a9bbb0', { tag: `${s.id}-${f.id}` });
    for (const side of [-1, 1]) kit.line([at(f.at, -f.halfWidth, 0, side * f.halfWidth), at(f.at, f.halfWidth, 0, side * f.halfWidth)], c.orange, { opacity: 0.75, tag: `${f.id}-contact` });
    if (kit.visible(f.loaded ? 'pressure' : 'pressureComparison')) kit.label(f.pressureText, at(center, 0, 0, f.halfWidth + u * 0.1), { color: c.ink, tag: `${f.id}-reading` });
  }
}

function pressureLiquids(v, kit) {
  const { unit: u, palette: c } = kit;
  liquidTank(v.pressureLiquid, kit);
  if (kit.visible('pressureComparison')) liquidTank(v.pressureComparisonLiquid, kit, true);
  for (const probe of v.pressureProbes ?? []) {
    if (!point(probe.at) || (!probe.primary && !kit.visible('pressureComparison'))) continue;
    const radius = u * 0.16;
    kit.cylinder(at(probe.at, 0, 0, -radius), at(probe.at, 0, 0, radius), radius, c.metal, { tag: probe.id });
    kit.circle(at(probe.at, 0, 0, radius * 1.05), radius * 0.68, c.ink);
    kit.sphere(at(probe.at, 0, 0, radius * 1.1), radius * 0.23, probe.primary ? c.orange : c.blue);
    // A flexible sensing hose returns to the surface, without encoding pressure
    // as an invented fluid-column height or a fabricated gauge deflection.
    const hoseX = probe.at.x - u * (probe.primary ? 0.42 : 0.7);
    kit.tube([probe.at, { x: hoseX, y: probe.at.y }, { x: hoseX, y: probe.surface + u * 0.45 }], u * 0.022, c.ink, { tag: `${probe.id}-hose` });
    if (kit.visible(probe.primary ? 'pressure' : 'pressureComparison')) kit.label(probe.readingText, at(probe.at, u * 0.75, 0), { color: probe.primary ? c.orange : c.blue, tag: `${probe.id}-reading` });
  }
}

function barometer(b, kit) {
  if (!b || !point(b.at) || ![b.surface, b.columnTop, b.tubeTop, b.dishDepth].every(finite)) return;
  const { unit: u, palette: c } = kit, x = b.at.x, floor = b.surface - b.dishDepth;
  const depth = b.dishHalfWidth * 0.9;
  vessel(x - b.dishHalfWidth, x + b.dishHalfWidth, floor, b.surface + u * 0.2, depth, kit, `${b.id}-dish`);
  if (b.dishDepth > 0) kit.box({ x, y: b.surface - b.dishDepth / 2, z: -depth * 0.15 }, b.dishHalfWidth * 2, b.dishDepth, depth * 0.95, c.metal, { tag: `${b.id}-mercury-pool` });
  if (b.tubeTop > floor) {
    kit.cylinder({ x, y: floor }, { x, y: b.tubeTop }, b.halfWidth * 1.12, c.glass, { opacity: 0.18, tag: `${b.id}-glass` });
    for (const side of [-1, 1]) kit.line([{ x: x + side * b.halfWidth, y: floor }, { x: x + side * b.halfWidth, y: b.tubeTop }], c.metal, { opacity: 0.65 });
    kit.circle({ x, y: b.tubeTop - b.halfWidth }, b.halfWidth, c.metal, { start: 0, end: Math.PI, tag: `${b.id}-sealed-top` });
  }
  if (b.columnTop > b.surface) kit.cylinder({ x, y: b.surface }, { x, y: b.columnTop }, b.halfWidth, '#899b9d', { tag: `${b.id}-mercury-column` });
  kit.line([{ x: x - b.halfWidth, y: b.columnTop }, { x: x + b.halfWidth, y: b.columnTop }], c.ink, { tag: `${b.id}-column-top` });
  if (b.tubeTop > b.columnTop) kit.label('真空', { x, y: (b.columnTop + b.tubeTop) / 2 }, { color: c.muted, tag: `${b.id}-vacuum` });
  if (kit.visible('pressure')) {
    kit.label(b.columnText, { x: x + u, y: b.columnTop }, { color: c.blue, tag: `${b.id}-height-reading` });
    kit.label(b.pressureText, { x, y: b.surface - b.dishDepth - u * 0.32 }, { tag: `${b.id}-pressure-reading` });
  }
}

function hemispheres(h, kit) {
  if (!h || !point(h.at) || !(h.radius > 0) || !kit.visible('pressureComparison')) return;
  const { unit: u, palette: c } = kit;
  for (const side of [-1, 1]) {
    const mesh = new kit.THREE.Mesh(new kit.THREE.SphereGeometry(h.radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new kit.THREE.MeshStandardMaterial({ color: side < 0 ? '#b69965' : '#bea779', metalness: 0.65, roughness: 0.32, side: kit.THREE.DoubleSide }));
    mesh.rotation.z = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.set(h.at.x, h.at.y, 0); mesh.userData.tag = `${h.id}-${side}`; kit.group.add(mesh);
    const handle = at(h.at, side * (h.radius + u * 0.15));
    kit.cylinder(at(h.at, side * h.radius), handle, u * 0.035, c.metal);
    kit.circle(at(handle, side * u * 0.12), u * 0.14, c.metal, { tag: `${h.id}-handle-${side}` });
  }
  kit.line([at(h.at, 0, -h.radius), at(h.at, 0, h.radius)], c.ink, { tag: `${h.id}-seal` });
  if (h.label) kit.label(h.label, at(h.at, 0, h.radius + u * 0.4), { tag: h.id });
  kit.label(h.forceText, at(h.at, 0, -h.radius - u * 0.38), { color: c.orange, tag: `${h.id}-force` });
}

function calibratedThermometer(t, kit) {
  if (!t || !point(t.at) || ![t.columnTop, t.icePoint, t.steamPoint, t.halfWidth, t.bulbRadius].every(finite)) return;
  const { unit: u, palette: c } = kit;
  const upper = Math.max(t.steamPoint, t.columnTop, t.at.y) + u * 0.8;
  const lower = Math.min(t.at.y, t.columnTop);
  const bulb = at(t.at, 0, -t.bulbRadius * 0.7);
  kit.box({ x: t.at.x + t.halfWidth * 0.9, y: (upper + lower) / 2, z: -t.halfWidth * 1.1 }, t.halfWidth * 4.2,
    upper - lower, t.halfWidth * 0.25, '#e7e2cf', { tag: `${t.id}-scale-backing` });
  kit.cylinder({ x: t.at.x, y: lower }, { x: t.at.x, y: upper }, t.halfWidth * 1.08, c.glass, { opacity: 0.24, tag: `${t.id}-tube` });
  kit.sphere(bulb, t.bulbRadius, c.glass, { opacity: 0.32, tag: `${t.id}-bulb-glass` });
  if (kit.visible('thermometer')) {
    if (t.columnTop !== t.at.y) kit.cylinder(t.at, { x: t.at.x, y: t.columnTop }, t.halfWidth * 0.72, c.red, { tag: `${t.id}-column` });
    kit.sphere(bulb, t.bulbRadius * 0.8, c.red, { tag: `${t.id}-bulb` });
    kit.label(t.temperatureText, { x: t.at.x - u * 1.3, y: t.columnTop }, { color: c.red, tag: `${t.id}-temperature` });
    kit.label(t.columnText, { x: t.at.x - u * 1.3, y: t.columnTop - u * 0.4 }, { color: c.muted, tag: `${t.id}-column-reading` });
  }
  if (kit.visible('guides')) {
    // Linear scale graduation is geometric subdivision between fixed-point
    // marks and belongs to the same scale observable as its labels.
    for (let i = 0; i <= 20; i++) {
      const y = t.icePoint + (t.steamPoint - t.icePoint) * i / 20;
      const length = t.halfWidth * (i % 5 === 0 ? 2.1 : 1.2);
      kit.line([{ x: t.at.x + t.halfWidth, y, z: t.halfWidth }, { x: t.at.x + t.halfWidth + length, y, z: t.halfWidth }], c.muted, { tag: `${t.id}-tick-${i}` });
    }
    for (const [y, label] of [[t.icePoint, '0 °C'], [t.steamPoint, '100 °C']]) kit.label(label, { x: t.at.x + t.halfWidth * 4.2, y }, { tag: `${t.id}-${label}` });
    kit.label(t.scaleText, { x: t.at.x - u * 1.55, y: (t.icePoint + t.steamPoint) / 2 + u * 0.7 }, { color: c.muted, tag: `${t.id}-sensitivity` });
  }
}

function sample(s, kit, comparison) {
  if (!s || !point(s.at) || !(s.halfWidth > 0) || !(s.halfHeight > 0)) return;
  const { unit: u, palette: c } = kit;
  const left = s.at.x - s.halfWidth, right = s.at.x + s.halfWidth;
  const floor = s.at.y - s.halfHeight, top = s.at.y + s.halfHeight;
  const depth = Math.min(s.halfWidth, u * 2.1);
  vessel(left, right, floor, top + u * 0.28, depth, kit, s.id);
  const showPhase = kit.visible('phase');
  if (!showPhase || !finite(s.meltedFraction)) kit.box(at(s.at, 0, 0, -depth * 0.15), s.halfWidth * 2, s.halfHeight * 2, depth * 0.93, '#cdd6cd', { opacity: 0.3, tag: `${s.id}-sample` });
  else {
    const fraction = Math.min(1, Math.max(0, s.meltedFraction));
    const liquidHeight = s.halfHeight * 2 * fraction;
    const solidHeight = s.halfHeight * 2 - liquidHeight;
    if (liquidHeight > 0) {
      kit.box({ x: s.at.x, y: floor + liquidHeight / 2, z: -depth * 0.15 }, s.halfWidth * 2, liquidHeight, depth * 0.94,
        comparison ? '#cab875' : c.glass, { opacity: 0.48, tag: `${s.id}-liquid-fraction` });
      kit.line([{ x: left, y: floor + liquidHeight }, { x: right, y: floor + liquidHeight }], comparison ? '#a49054' : c.blue, { tag: `${s.id}-meniscus` });
    }
    if (solidHeight > 0) {
      kit.box({ x: s.at.x, y: top - solidHeight / 2, z: -depth * 0.15 }, s.halfWidth * 2, solidHeight, depth * 0.93, '#b9d6da', { opacity: 0.78, tag: `${s.id}-solid-fraction` });
      // Facet seams distinguish the remaining crystalline sample. They remain
      // within the exact solid fraction, including an arbitrarily thin remnant.
      for (let i = 1; i < 4; i++) kit.line([{ x: left + i * s.halfWidth / 2, y: top, z: depth * 0.34 },
        { x: left + (i - 0.3) * s.halfWidth / 2, y: top - solidHeight, z: depth * 0.34 }], '#eaf5f1', { opacity: 0.7 });
    }
    if (s.phase === 'boiling' && liquidHeight > 0) for (let i = 0; i < 6; i++) {
      const p = { x: s.at.x + ((i % 3) - 1) * s.halfWidth * 0.5,
        y: floor + liquidHeight * (0.2 + Math.floor(i / 3) * 0.45), z: depth * 0.35 };
      kit.circle(p, u * (0.08 + (i % 2) * 0.035), '#f4faf6', { tag: `${s.id}-boiling-bubble-${i}` });
    }
  }
  if (s.label) kit.label(s.label, { x: s.at.x, y: top + u * 0.62 }, { tag: `${s.id}-label` });
  if (showPhase) kit.label(({ solid: '固态', melting: '熔化中', liquid: '液态', boiling: '沸腾中' })[s.phase] ?? '',
    { x: s.at.x, y: floor + u * 0.35, z: depth * 0.4 }, { color: c.ink, tag: `${s.id}-phase` });
}

function thermalThermometer(t, kit) {
  if (!t || !point(t.at) || !finite(t.columnHeight) || !kit.visible('thermometer')) return;
  const { unit: u, palette: c } = kit;
  const top = Math.max(15, t.columnHeight + u * 0.35);
  const low = Math.min(0, t.columnHeight);
  kit.cylinder(at(t.at, 0, low), at(t.at, 0, top), u * 0.105, c.glass, { opacity: 0.28, tag: `${t.id}-glass` });
  if (t.columnHeight !== 0) kit.cylinder(t.at, at(t.at, 0, t.columnHeight), u * 0.046, c.red, { tag: `${t.id}-column` });
  kit.sphere(t.at, u * 0.18, c.red, { tag: `${t.id}-bulb` });
  for (let i = 0; i <= 10; i++) {
    const y = 15 * i / 10;
    kit.line([at(t.at, u * 0.13, y), at(t.at, u * (i % 5 === 0 ? 0.34 : 0.25), y)], c.muted);
  }
  kit.label(t.reading, at(t.at, u * 0.55, t.columnHeight + u * 0.22), { color: c.red, tag: `${t.id}-reading` });
}

function heater(h, kit) {
  if (!h || !point(h.at) || !(h.halfWidth > 0)) return;
  const { unit: u, palette: c } = kit;
  // An electric hotplate avoids animating a made-up flame or asserting a gas
  // burner. Its power is the supplied reading, including zero.
  kit.box(at(h.at, 0, -u * 0.23), h.halfWidth * 2, u * 0.46, u * 1.65, c.green, { tag: h.id });
  kit.box(at(h.at, 0, u * 0.025), h.halfWidth * 2.06, u * 0.08, u * 1.68, c.metal, { tag: `${h.id}-plate` });
  kit.cylinder(at(h.at, h.halfWidth * 0.6, -u * 0.24, u * 0.82), at(h.at, h.halfWidth * 0.6, -u * 0.24, u * 0.91), u * 0.09, c.ink);
  kit.label(h.power, at(h.at, 0, -u * 0.65), { tag: `${h.id}-power` });
}

function photoelectric(snapshot, kit) {
  const v = snapshot.view, { unit: u, palette: c } = kit;
  const cathode = (v.particles ?? []).find(p => p.id === 'modern-cathode');
  if (!cathode || !point(cathode.at)) return;
  const photons = (v.trajectories ?? []).filter(p => p.id.startsWith('modern-photon-'));
  const electrons = (v.trajectories ?? []).filter(p => p.id.startsWith('modern-electron-'));
  const photonPoints = photons.flatMap(p => p.points).filter(point), electronPoints = electrons.flatMap(p => p.points).filter(point);
  const allPoints = [...photonPoints, ...electronPoints];
  const cy = cathode.at.y;
  const half = Math.max(cathode.radius, ...allPoints.map(p => Math.abs(p.y - cy))) + u * 0.35;
  const right = electronPoints.length ? Math.max(...electronPoints.map(p => p.x)) : v.origin.x + v.extent.width * 0.9;
  const left = cathode.at.x - u * 0.68;
  const width = right - left;
  if (width > 0) {
    // Glass envelope and electrode mounts are apparatus dimensions only. The
    // cathode and emitted particles stay at their published xy coordinates.
    kit.box({ x: (left + right) / 2, y: cy, z: -u * 0.4 }, width + u * 0.5, half * 2.1, u * 1.15, c.glass, { opacity: 0.1, tag: 'photoelectric-vacuum-tube' });
    const corners = [{ x: left - u * 0.25, y: cy - half * 1.05 }, { x: right + u * 0.25, y: cy - half * 1.05 },
      { x: right + u * 0.25, y: cy + half * 1.05 }, { x: left - u * 0.25, y: cy + half * 1.05 }];
    kit.line([...corners, corners[0]], c.metal, { opacity: 0.45, tag: 'photoelectric-envelope-edge' });
  }
  kit.box(cathode.at, u * 0.19, half * 2, u * 0.8, '#ac9d7a', { tag: cathode.id });
  kit.line([at(cathode.at, -u * 0.1, -half), at(cathode.at, -u * 0.1, half)], c.orange, { tag: 'photoelectric-active-surface' });
  // The collecting electrode is mounted at the supplied electron-path ends.
  // When no electron is emitted it remains the same schematic apparatus.
  kit.box({ x: right, y: cy, z: -u * 0.15 }, u * 0.14, half * 2, u * 0.72, c.metal, { tag: 'photoelectric-collector' });
  if (photonPoints.length) {
    const sourceX = Math.min(...photonPoints.map(p => p.x));
    kit.box({ x: sourceX - u * 0.18, y: cy, z: -u * 0.12 }, u * 0.55, half * 1.25, u * 0.85, c.green, { tag: 'photoelectric-light-source' });
    for (const path of photons) if (point(path.points[0])) kit.sphere(path.points[0], u * 0.07, c.orange, { tag: `${path.id}-aperture` });
  }
  if (kit.visible('photocurrent')) for (const p of v.particles ?? []) {
    if (p.id === cathode.id || !point(p.at) || !(p.radius > 0)) continue;
    kit.sphere(p.at, p.radius, c.blue, { tag: p.id });
    if (p.symbol) kit.label(p.symbol, at(p.at, 0, -p.radius - u * 0.24), { color: c.blue, tag: `${p.id}-label` });
  }
  const wireY = Math.max(v.origin.y + u * 0.65, cy - half - u * 0.65);
  kit.tube([at(cathode.at, 0, -half), { x: cathode.at.x, y: wireY }, { x: right, y: wireY }, { x: right, y: cy - half }], u * 0.023, c.ink, { tag: 'photoelectric-meter-circuit' });
  const meter = { x: cathode.at.x + (right - cathode.at.x) * 0.72, y: wireY };
  dial(meter, u * 0.32, undefined, kit, 'photoelectric-ammeter');
  if (kit.visible('photocurrent')) kit.label('A', at(meter, 0, 0, u * 0.11), { tag: 'photoelectric-ammeter-face' });
  if (kit.visible('stoppingPotential')) {
    const power = { x: cathode.at.x + (right - cathode.at.x) * 0.3, y: wireY };
    kit.box(power, u * 0.8, u * 0.45, u * 0.28, c.green, { tag: 'photoelectric-bias-supply' });
    kit.label('Uₛ', at(power, 0, 0, u * 0.16), { tag: 'photoelectric-voltage-face' });
  }
}

export function drawMatter(snapshot, kit) {
  const v = snapshot.view;
  if (!v) return;
  if (v.domain === 'modern') { photoelectric(snapshot, kit); return; }
  if (v.domain === 'fluid') {
    if (v.pressureRig === 'solid') solidPressure(v.pressureSolid, kit);
    else if (v.pressureRig === 'liquid') pressureLiquids(v, kit);
    else if (v.pressureRig === 'atmospheric') { barometer(v.pressureBarometer, kit); hemispheres(v.pressureHemispheres, kit); }
    else buoyancy(v, kit);
    return;
  }
  if (v.thermometer) calibratedThermometer(v.thermometer, kit);
  else {
    heater(v.thermalHeater, kit); heater(v.thermalComparisonHeater, kit);
    sample(v.thermalSample, kit, false); sample(v.thermalComparisonSample, kit, true);
    thermalThermometer(v.thermalThermometer, kit); thermalThermometer(v.thermalComparisonThermometer, kit);
  }
}
